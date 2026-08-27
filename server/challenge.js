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

// Label for the opening balance in the attribution table when row 1 does not
// name where its capital came from.
export const OPENING_LABEL = "opening balance";

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

// Where every dollar in the account came from, ready to publish.
//
// Adam, 2026-08-16: "when we reach 10k we state how we got there. savings added
// $2500, job added this, win rate added this, etc." This builds exactly that
// sentence, and it is exact rather than estimated: the buckets are the opening
// balance, one bucket per funding source, and the trading P&L as the remainder.
// They sum to the current balance by construction, which `reconciles` asserts
// rather than assumes.
//
// Sources are matched case-insensitively and trimmed, so "Savings" and
// "savings " land in one bucket instead of quietly becoming two.
export function attribution(ledger = []) {
  const rows = Array.isArray(ledger) ? ledger : [];
  const opening = rows[0];
  if (!opening || !isNum(opening.total_value)) return null;

  const latest = rows[rows.length - 1];
  const openingLabel =
    typeof opening.deposit_source === "string" && opening.deposit_source.trim()
      ? opening.deposit_source.trim()
      : OPENING_LABEL;

  // Insertion-ordered, so the table reads in the order the money actually
  // arrived rather than alphabetically.
  const bySource = new Map([[openingLabel, opening.total_value]]);
  const addTo = (label, amount) => {
    const key = label.trim();
    const existing = [...bySource.keys()].find((k) => k.toLowerCase() === key.toLowerCase());
    const at = existing ?? key;
    bySource.set(at, round((bySource.get(at) ?? 0) + amount, 2));
  };

  // Skip row 0: its balance is the opening bucket, not a deposit on top of it.
  for (const r of rows.slice(1)) {
    if (!isNum(r.deposit) || r.deposit === 0) continue;
    addTo(
      typeof r.deposit_source === "string" && r.deposit_source.trim()
        ? r.deposit_source
        : "unlabelled",
      r.deposit
    );
  }

  const contributed = contributedAt(rows.slice(0, -1), latest);
  const tradingPnl = round(latest.total_value - contributed, 2);

  const sources = [...bySource.entries()].map(([source, amount]) => ({
    source,
    amount: round(amount, 2),
  }));

  const summed = round(
    sources.reduce((t, s) => t + s.amount, 0) + tradingPnl,
    2
  );

  return {
    date: latest.date,
    total_value: latest.total_value,
    contributed,
    trading_pnl: tradingPnl,
    sources,
    // If this is ever false the table is lying, and the caller must say so
    // rather than print it. Cheap check, and it is the whole trustworthiness
    // of the final post.
    reconciles: Math.abs(summed - latest.total_value) <= RECONCILE_TOLERANCE,
    summed,
  };
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

  // Money moving in or out has to say WHERE FROM, at the moment it moves.
  //
  // The whole point of this ledger is the sentence written when the target is
  // hit: "savings put in X, the job put in Y, the trading earned Z." That
  // sentence is only true if each dollar was labelled on the way in. Working it
  // out afterwards from balances is reconstruction, and reconstruction is what
  // produced a public post on 2026-08-16 asserting a withdrawal nobody had
  // observed. The broker reports balances and trades; it never reports why
  // money moved. Only Adam knows that, so he has to say it at the time.
  if (isNum(row.deposit) && row.deposit !== 0) {
    if (typeof row.deposit_source !== "string" || !row.deposit_source.trim()) {
      problems.push(
        `deposit of ${row.deposit} has no deposit_source — say where the money came from ` +
          `(or went to) at the time it moved, e.g. "savings", "job", "bills". ` +
          `It cannot be recovered later.`
      );
    }
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
      // Null, never "" or "unknown" -- an unlabelled zero-deposit row simply has
      // nothing to label, and that is different from a movement we failed to ask
      // about. validateSnapshot already refuses the second case.
      deposit_source: typeof row.deposit_source === "string" && row.deposit_source.trim()
        ? row.deposit_source.trim()
        : null,
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
