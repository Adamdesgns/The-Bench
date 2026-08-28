// snapshot-challenge.js — append one dated balance to the challenge ledger.
//
//   node scripts/snapshot-challenge.js --date 2026-08-04 --total 545.81 \
//        --equity 377.09 --cash 168.72 --options 0 --source robinhood-mcp
//
//   --dry-run     validate and print, write nothing
//
// WHY THE NUMBERS ARE ARGUMENTS AND NOT FETCHED HERE:
// the broker is reachable through the Robinhood MCP, which is a tool available
// to the agent, not an HTTP API this script can call. So the routine pulls
// get_portfolio, passes the figures in, and this script's job is to refuse
// anything that does not reconcile. A hand-typed balance will not reconcile
// against equity + cash + options, which is exactly the check that keeps the
// public ledger honest.
//
// Spec: docs/challenge-spec.md

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROOT } from "../server/config.js";
import { appendSnapshot, computeProgress, scopeChanged, TARGET } from "../server/challenge.js";

const LEDGER_PATH = resolve(ROOT, "db/challenge.json");

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
// undefined stays undefined so validateSnapshot can complain about it, rather
// than a missing figure quietly becoming 0.
const num = (flag) => {
  const raw = valueOf(flag);
  return raw === undefined ? undefined : Number(raw);
};

const dryRun = has("--dry-run");

const accountsArg = valueOf("--accounts");

const row = {
  date: valueOf("--date"),
  total_value: num("--total"),
  equity_value: num("--equity"),
  cash: num("--cash"),
  options_value: num("--options") ?? 0,
  // Net external transfer since the last row. Positive = money in, negative =
  // money out. Allowed, but never counted as profit.
  deposit: num("--deposit") ?? 0,
  // WHERE the money came from or went to. Required whenever --deposit is not
  // zero; the ledger refuses an unlabelled movement. This is the field the
  // final "how we got to $10,000" breakdown is built from, and it cannot be
  // reconstructed afterwards -- the broker never reports why money moved.
  deposit_source: valueOf("--source-of-funds"),
  accounts: accountsArg ? accountsArg.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
  source: valueOf("--source") ?? "robinhood-mcp",
  note: valueOf("--note") ?? null,
};

const ledger = existsSync(LEDGER_PATH)
  ? JSON.parse(readFileSync(LEDGER_PATH, "utf8"))
  : [];

let next;
try {
  next = appendSnapshot(ledger, row);
} catch (e) {
  console.error(String(e.message));
  process.exit(1);
}

const added = next[next.length - 1];
const start = next[0];
const progress = computeProgress(added, start);

console.log(`CHALLENGE SNAPSHOT — ${added.date}`);
console.log(`  account value   $${added.total_value.toFixed(2)}`);
console.log(`    equity        $${added.equity_value.toFixed(2)}`);
console.log(`    cash          $${added.cash.toFixed(2)}`);
console.log(`    options       $${added.options_value.toFixed(2)}`);
console.log(`  accounts        ${added.accounts.join(", ")}`);
console.log(`  started at      $${start.total_value.toFixed(2)} on ${start.date}`);
if (added.deposit) {
  console.log(
    `  transfer        ${added.deposit > 0 ? "+" : ""}$${added.deposit.toFixed(2)} this period` +
      ` (${added.deposit_source})`
  );
}
console.log("");
console.log(`  contributed     $${added.contributed.toFixed(2)}   <- money PUT IN`);
console.log(`  trading P&L     ${added.trading_pnl > 0 ? "+" : ""}$${added.trading_pnl.toFixed(2)}   <- money EARNED`);
console.log(`  return on it    ${added.pct_return_on_contributed > 0 ? "+" : ""}${added.pct_return_on_contributed}%`);
console.log("");
console.log(`  to $${TARGET}     ${progress.multipleToTarget}x to go (${progress.pctOfTarget}% of target)`);
console.log(`  source          ${added.source}`);

// Publish trading P&L, not raw account growth. With deposits in play they are
// different numbers, and only one of them says whether the trading worked.
if (added.contributed > start.total_value) {
  console.log(
    `\n  NOTE: $${(added.contributed - start.total_value).toFixed(2)} of this account was transferred in, ` +
      `not earned.\n        The headline number for any post is trading P&L ` +
      `(${added.trading_pnl > 0 ? "+" : ""}$${added.trading_pnl.toFixed(2)}), not the balance.`
  );
}

if (scopeChanged(ledger, added)) {
  const prevScope = (ledger[ledger.length - 1].accounts ?? []).join(", ");
  console.log(
    `\n  !! account scope changed: [${prevScope}] -> [${added.accounts.join(", ")}]. ` +
      `The balance moved because the scope moved. Say so in the post.`
  );
}

// A big single-step move is usually a deposit or a typo, not a trade. Say so
// loudly; the routine has to explain it in the post either way.
if (ledger.length) {
  const prev = ledger[ledger.length - 1];
  const step = ((added.total_value - prev.total_value) / prev.total_value) * 100;
  if (Math.abs(step) >= 30) {
    console.log(
      `\n  !! ${step > 0 ? "+" : ""}${step.toFixed(1)}% since ${prev.date}. ` +
        `Confirm this is trading P&L and not a deposit or withdrawal before posting.`
    );
  }
}

if (dryRun) {
  console.log("\n--dry-run: ledger NOT written.");
  process.exit(0);
}

writeFileSync(LEDGER_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
console.log(`\nwrote ${LEDGER_PATH} (${next.length} row${next.length === 1 ? "" : "s"})`);
