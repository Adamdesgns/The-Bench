// challenge-attribution.js — where every dollar in the challenge account came from.
//
//   node scripts/challenge-attribution.js
//   node scripts/challenge-attribution.js --json
//
// This is the script that writes the post at the finish line. Adam, 2026-08-16:
// "when we reach 10k we state how we got there. savings added $2500, job added
// this, win rate added this, etc."
//
// WHY IT IS A SCRIPT AND NOT A MEMORY EXERCISE:
// the breakdown is only honest if each dollar was labelled the week it arrived.
// Working it out afterwards from balances is reconstruction, and reconstruction
// is what put a withdrawal nobody had observed into a public post on 2026-08-16.
// So `snapshot-challenge.js` refuses an unlabelled transfer, and this reads the
// labels back. Nothing here infers anything.
//
// Spec: docs/challenge-spec.md

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROOT } from "../server/config.js";
import { attribution, TARGET } from "../server/challenge.js";

const LEDGER_PATH = resolve(ROOT, "db/challenge.json");
const asJson = process.argv.slice(2).includes("--json");

if (!existsSync(LEDGER_PATH)) {
  console.error(`no ledger at ${LEDGER_PATH}`);
  process.exit(1);
}

const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
const report = attribution(ledger);

if (!report) {
  console.error("ledger is empty or its opening row has no balance — nothing to attribute");
  process.exit(1);
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.reconciles ? 0 : 1);
}

const money = (n) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const width = Math.max(12, ...report.sources.map((s) => s.source.length));
const pad = (s) => s.padEnd(width, " ");

console.log(`HOW THE ACCOUNT GOT HERE — ${report.date}`);
console.log("");
for (const { source, amount } of report.sources) {
  console.log(`  ${pad(source)}  ${money(amount).padStart(12)}   put in`);
}
console.log(`  ${pad("trading P&L")}  ${money(report.trading_pnl).padStart(12)}   earned`);
console.log(`  ${"-".repeat(width + 16)}`);
console.log(`  ${pad("account value")}  ${money(report.total_value).padStart(12)}`);
console.log("");
console.log(`  contributed     ${money(report.contributed)}   <- money PUT IN`);
console.log(`  trading P&L     ${money(report.trading_pnl)}   <- money EARNED`);

const unlabelled = report.sources.find((s) => s.source === "unlabelled");
if (unlabelled) {
  console.log(
    `\n  !! ${money(unlabelled.amount)} is UNLABELLED — a transfer was recorded without ` +
      `a source.\n     Do not publish this breakdown until it is attributed.`
  );
}

if (!report.reconciles) {
  console.log(
    `\n  !! DOES NOT RECONCILE: the buckets sum to ${money(report.summed)} against an ` +
      `account value of ${money(report.total_value)}.\n     This table is wrong. Do not publish it.`
  );
  process.exit(1);
}

if (report.total_value >= TARGET) {
  console.log(`\n  TARGET REACHED. This is the breakdown that goes in the post.`);
} else {
  const togo = TARGET - report.total_value;
  console.log(`\n  ${money(togo)} to $${TARGET} (${(TARGET / report.total_value).toFixed(2)}x to go)`);
}
