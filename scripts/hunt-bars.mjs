// hunt-bars.mjs — wrap raw Robinhood MCP results into the file Hunter reads (hunter-bars-file-v1).
//
//   node scripts/hunt-bars.mjs --historicals <tool-result.json> [--historicals <another>]
//        [--earnings-back <tool-result.json> --earnings-ahead <tool-result.json> --anchor YYYY-MM-DD]
//        --out <bars.json> [--source "<who pulled it>"]
//
// WHY THIS EXISTS (2026-09-10, Adam: "we need to be independent of codex")
// ------------------------------------------------------------------------
// Hunter reads Robinhood through Codex, and every run spends Codex usage. The desk already
// holds a Robinhood MCP session of its own; a get_equity_historicals call made there lands on
// disk as the raw tool result. This script takes those files as they are - not a bar is
// edited - and writes the one file Hunter's --bars flag accepts. Same provider, same tool,
// same payload; the parity fixture in research/prepump/parity proves the analysis is
// byte-identical to the Codex path.
//
// Inputs are the tool results exactly as saved: {data:{results:[...],not_found?:[...]},guide}.
// The historicals request is reconstructed from the payload (symbols from the results plus
// not_found) so the file is honest about what it holds; window fields are informational,
// Hunter's own session calendar does the filtering.
//
// Nothing here calls a provider. Nothing here touches the book.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const vals = (f) => argv.flatMap((a, i) => (a === f && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
const val = (f) => vals(f)[0];

function isRecord(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }

// Unwrap {data, guide} whether it sits at the top or under structuredContent.
function payloadOf(raw, label) {
  const candidates = [];
  if (isRecord(raw) && Object.hasOwn(raw, "structuredContent")) candidates.push(raw.structuredContent);
  if (isRecord(raw) && Object.hasOwn(raw, "structured_content")) candidates.push(raw.structured_content);
  if (isRecord(raw) && Object.hasOwn(raw, "data") && Object.hasOwn(raw, "guide")) candidates.push(raw);
  if (candidates.length !== 1 || !isRecord(candidates[0]) || !isRecord(candidates[0].data)) {
    throw new Error(`${label}: not a Robinhood tool result ({data, guide})`);
  }
  return candidates[0];
}

// Pure: build the bars file body from already-parsed tool results.
export function buildBarsFile({ historicals, earningsBack, earningsAhead, anchor, source, capturedAt }) {
  if (!Array.isArray(historicals) || historicals.length === 0) throw new Error("at least one --historicals result is required");
  const hist = historicals.map((raw, i) => {
    const payload = payloadOf(raw, `historicals[${i}]`);
    const results = Array.isArray(payload.data.results) ? payload.data.results : [];
    const symbols = [
      ...results.filter((r) => isRecord(r) && typeof r.symbol === "string").map((r) => r.symbol),
      ...(Array.isArray(payload.data.not_found) ? payload.data.not_found : []),
    ];
    if (symbols.length === 0) throw new Error(`historicals[${i}]: carries no symbols`);
    const bars = results.flatMap((r) => (isRecord(r) && Array.isArray(r.bars) ? r.bars : []));
    const times = bars.map((b) => (isRecord(b) ? b.begins_at : undefined)).filter((t) => typeof t === "string").sort();
    return {
      request: {
        symbols: [...new Set(symbols)].sort(),
        start_time: times[0] ?? null,
        end_time: times[times.length - 1] ?? null,
        interval: "day", bounds: "regular", adjustment_type: "split",
      },
      response: payload,
    };
  });

  const earnings = [];
  if (earningsBack || earningsAhead) {
    if (!earningsBack || !earningsAhead) throw new Error("--earnings-back and --earnings-ahead go together");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(anchor))) throw new Error("--anchor YYYY-MM-DD is required with earnings results (the last completed session date)");
    earnings.push({ request: { start_date: anchor, days: -31 }, response: payloadOf(earningsBack, "earnings-back") });
    earnings.push({ request: { start_date: anchor, days: 31 }, response: payloadOf(earningsAhead, "earnings-ahead") });
  }

  return {
    version: "hunter-bars-file-v1",
    capturedAt: capturedAt ?? new Date().toISOString(),
    source: source ?? "robinhood:mcp:equity-historicals via the desk's own Robinhood MCP session",
    historicals: hist,
    ...(earnings.length ? { earningsCalendar: earnings } : {}),
  };
}

function main() {
  const out = val("--out");
  if (!out) { console.error("usage: hunt-bars.mjs --historicals <file> [--earnings-back <f> --earnings-ahead <f> --anchor YYYY-MM-DD] --out <bars.json>"); process.exit(2); }
  const read = (p) => JSON.parse(readFileSync(resolve(p), "utf8"));
  const body = buildBarsFile({
    historicals: vals("--historicals").map(read),
    earningsBack: val("--earnings-back") ? read(val("--earnings-back")) : undefined,
    earningsAhead: val("--earnings-ahead") ? read(val("--earnings-ahead")) : undefined,
    anchor: val("--anchor"),
    source: val("--source"),
  });
  writeFileSync(resolve(out), JSON.stringify(body), "utf8");
  const symbols = body.historicals.flatMap((h) => h.request.symbols);
  console.log(`bars file written: ${resolve(out)}`);
  console.log(`  ${symbols.length} symbols (${symbols.join(", ")}), ${body.earningsCalendar ? "earnings calendar included" : "no earnings calendar"}, captured ${body.capturedAt}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) main();
