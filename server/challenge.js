// challenge.js — the account-challenge ledger rules. Pure: no network, no fs.
//
// The challenge is public, so the ledger is the thing that has to be
// trustworthy. Three rules do most of that work:
//
//   - APPEND-ONLY. A date already recorded is never rewritten, and a date
//     earlier than the last row is refused. The record cannot be tidied up
//     after a bad week.
//   - THE PARTS MUST RECONCILE. total_value has to equal equity + cash +
//     options within two cents. A hand-typed balance will not reconcile, and
//     that is the point -- the number has to come from the broker.
//   - NOTHING IS COERCED. A missing or non-numeric figure is an error, never
//     a zero. Same rule the scorer uses: never invent a number.
//
// Spec: docs/challenge-spec.md

export const TARGET = 10000;

// The account the challenge started on. Rows may cover more than one -- using
// options can mean trading the margin account too -- so every row records what
// it covers. A change of scope is then visible in the record instead of showing
// up as an unexplained jump in the balance.
export const DEFAULT_ACCOUNTS = ["769507724"];

// Reconciliation tolerance, in dollars. Robinhood rounds its own components,
// so a couple of cents of drift is real and expected; anything larger means
// the numbers did not come from one snapshot.
const RECONCILE_TOLERANCE = 0.02;

const round = (n, places) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Percentage move from `from` to `to`. Null when there is no base to move
// from -- an undefined percentage, not an infinite one.
export function pctChange(from, to) {
  if (!isNum(from) || !isNum(to) || from === 0) return null;
  return round(((to - from) / from) * 100, 2);
}

// Where the account stands relative to where it started and where it is going.
// multipleToTarget is the honest headline: "18.32x to go" lands differently
// than "5.5% of the way there", and both are the same fact.
export function computeProgress(row, startRow, target = TARGET) {
  const start = startRow?.total_value;
  const now = row?.total_value;
  return {
    pctFromStart: pctChange(start, now) ?? 0,
    multipleToTarget: isNum(now) && now > 0 ? round(target / now, 2) : null,
    pctOfTarget: isNum(now) ? round((now / target) * 100, 1) : null,
  };
}

// Total dollars PUT IN: the starting balance plus every deposit since, minus
// every withdrawal. This is the number profit has to be measured against.
//
// Transferring money in is allowed. Counting it as profit is not -- that is the
// specific dishonesty every account-challenge scam runs on, and separating the
// two is what makes deposits safe to allow at all.
export function contributedAt(ledger = [], row) {
  const first = ledger[0] ?? row;
  let total = isNum(first?.total_value) ? first.total_value : 0;

  for (const r of ledger.slice(1)) {
    if (isNum(r.deposit)) total += r.deposit;
  }
  // Skip when `row` IS the opening row -- its balance is the base, not a deposit.
  const isOpeningRow = ledger[0] && row && ledger[0].date === row.date;
  if (!isOpeningRow && isNum(row?.deposit)) total += row.deposit;

  return round(total, 2);
}

// True when this row covers a different set of accounts than the last one.
// Worth surfacing: widening scope moves the balance without a trade happening.
export function scopeChanged(ledger = [], row) {
  const last = ledger[ledger.length - 1];
  if (!last) return false;
  const a = (last.accounts ?? DEFAULT_ACCOUNTS).join(",");
  const b = (row?.accounts ?? DEFAULT_ACCOUNTS).join(",");
  return a !== b;
}

// Returns the reasons this snapshot must NOT be written. Empty array = safe.
export function validateSnapshot(row, ledger = []) {
  const problems = [];
  if (!row || typeof row !== "object") return ["snapshot is not an object"];

  for (const field of ["total_value", "equity_value", "cash"]) {
    if (!isNum(row[field])) {
      problems.push(`${field} is missing or not a number (got ${JSON.stringify(row[field])})`);
    }
  }

  if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
    problems.push(`date is missing or not YYYY-MM-DD (got ${JSON.stringify(row.date)})`);
  }

  if (!row.source) {
    problems.push("source is missing — a balance must be attributed to where it came from");
  }

  // Optional, but if present it has to be a real number. A deposit that arrives
  // as a string would be skipped by the arithmetic and silently become profit.
  if (row.deposit !== undefined && row.deposit !== null && !isNum(row.deposit)) {
    problems.push(`deposit is not a number (got ${JSON.stringify(row.deposit)})`);
  }

  if (row.accounts !== undefined) {
    if (!Array.isArray(row.accounts) || row.accounts.length === 0) {
      problems.push("accounts must be a non-empty list — every row records which accounts it covers");
    }
  }

  // Only worth checking once the components are actually numbers.
  if (!problems.some((p) => p.includes("is missing or not a number"))) {
    const parts = row.equity_value + row.cash + (isNum(row.options_value) ? row.options_value : 0);
    if (Math.abs(row.total_value - parts) > RECONCILE_TOLERANCE) {
      problems.push(
        `total_value ${row.total_value} does not reconcile with equity + cash + options ` +
          `(${round(parts, 2)}) — off by ${round(row.total_value - parts, 2)}`
      );
    }
  }

  if (row.date) {
    if (ledger.some((r) => r.date === row.date)) {
      problems.push(`${row.date} is already recorded — the ledger is append-only`);
    }
    const last = ledger[ledger.length - 1];
    if (last && row.date < last.date) {
      problems.push(`${row.date} is earlier than the last row (${last.date})`);
    }
  }

  return problems;
}

// Returns a NEW ledger with the snapshot appended and its progress stamped on.
// Throws rather than writing anything questionable.
export function appendSnapshot(ledger = [], row) {
  const problems = validateSnapshot(row, ledger);
  if (problems.length) {
    throw new Error(`refusing to append snapshot: ${problems.join("; ")}`);
  }

  const startRow = ledger[0] ?? row;
  const progress = computeProgress(row, startRow);
  const contributed = contributedAt(ledger, row);
  const tradingPnl = round(row.total_value - contributed, 2);

  return [
    ...ledger,
    {
      ...row,
      accounts: row.accounts ?? DEFAULT_ACCOUNTS,
      options_value: isNum(row.options_value) ? row.options_value : 0,
      deposit: isNum(row.deposit) ? row.deposit : 0,
      pct_from_start: progress.pctFromStart,
      multiple_to_target: progress.multipleToTarget,
      pct_of_target: progress.pctOfTarget,
      // The two numbers that keep deposits honest. contributed is what went in;
      // trading_pnl is the only figure that says whether the trading worked.
      contributed,
      trading_pnl: tradingPnl,
      pct_return_on_contributed: contributed > 0 ? round((tradingPnl / contributed) * 100, 2) : null,
    },
  ];
}
