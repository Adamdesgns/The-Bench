// reviewer.js — THE CHAIN.
//
//   loadArchive -> fetchDataPacket -> callBench(v17) -> reconcileArchive
//     -> renderArchiveBlock -> selectAngle -> callMarquee -> lint -> present
//
// The chain ends at present(). It NEVER posts. If reconcile fails, the run
// halts and reports — no article is written against an unreconciled board.
//
// Run:
//   node server/reviewer.js            # live (needs a model key + network)
//   node server/reviewer.js --mock     # offline: stubbed data + model, full chain
//   node server/reviewer.js --json      # also dump the raw verdict JSON

import { providerFor, ENGINE_TAG } from "./config.js";
import { loadArchive, isOpen, reconcile, renderArchiveBlock } from "./reconcile.js";
import { getQuote, getDailyCloses, avRemaining, NOT_OBSERVABLE } from "./dataProviders.js";
import { computeIndicators } from "./indicators.js";
import { callStructured, callText, engineTag } from "./llm.js";
import { loadBenchPrompt, loadMarqueePrompt } from "./benchPrompt.js";
import { benchResponseSchema } from "./reviewSchema.js";
import { selectAngle } from "./angle.js";
import { lintArticle } from "./lint.js";

const PEERS = ["SSNLF", "TSM", "ASML", "LVMUY", "TM"]; // global peer proxies
const MACRO = ["USO", "GLD", "UUP", "TLT", "^VIX"]; // ETF/proxy stand-ins for wti/gold/dxy/rates/vix
const CRYPTO_CTX = ["BTC", "ETH"];

function stampNow() {
  return new Date().toISOString();
}

// ---- Mock data (deterministic, offline) ----
function mockSeries(ticker, base) {
  const closes = [];
  let p = base;
  for (let i = 0; i < 220; i++) {
    // deterministic wiggle keyed off ticker + index (no Math.random)
    const seed = (ticker.charCodeAt(i % ticker.length) + i) % 7;
    p = Math.max(0.01, p * (1 + (seed - 3) / 300));
    closes.push(Number(p.toFixed(2)));
  }
  return closes;
}
function mockQuote(ticker, base) {
  const closes = mockSeries(ticker, base);
  return { ticker, price: closes[closes.length - 1], source: "mock", asof: "mock", provisional: true, closes };
}

async function buildDataPacket(archive, { mock }) {
  const open = archive.filter(isOpen);
  const board = [];
  const quotes = new Map();

  for (const row of open) {
    let q;
    if (mock) {
      q = mockQuote(row.ticker, typeof row.review_price === "number" ? row.review_price : 100);
    } else {
      q = await getQuote(row.ticker);
      const hist = await getDailyCloses(row.ticker);
      q.closes = hist.closes;
    }
    quotes.set(row.ticker, q);
    const ind = q.closes && q.closes.length >= 30 ? computeIndicators(q.closes) : null;
    board.push({
      id: row.id,
      ticker: row.ticker,
      state: row.state || row.final_call || "",
      review_price: row.review_price,
      last: typeof q.price === "number" ? q.price : NOT_OBSERVABLE,
      source: q.source,
      provisional: q.provisional,
      indicators: ind
        ? { rsi14: round(ind.rsi14), sma50: round(ind.sma50), sma200: round(ind.sma200), trend_strength: ind.trend_strength }
        : "not observable"
    });
  }

  const packet = {
    review_stamp: stampNow(),
    mode: "Research / Battle-Test Mode",
    open_board: board,
    peers: mock ? "not observable (mock run)" : "fetched below",
    av_calls_remaining: avRemaining(),
    note: "Every field not fetched live is the literal string 'not observable'."
  };
  return { packet, quotes };
}

const round = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);

// ---- Mock model ----
function mockModel(packet) {
  return {
    structured: () => {
      const openTickers = packet.open_board.map((b) => b.ticker);
      const first = packet.open_board[0];
      return {
        review_stamp: packet.review_stamp,
        regime: "Neutral",
        market_risk: 3,
        global_peer_read: "not verified this hour (mock run).",
        us_read: "Futures flat; leadership mixed (mock run).",
        crypto_read: "not verified this hour (mock run).",
        board: packet.open_board.map((b) => ({
          id: b.id,
          ticker: b.ticker,
          state: b.state || "Watching",
          action: b.state || "No change",
          note: "mock reconcile"
        })),
        assumption_ledger: [
          { assumption: "Correction is rotational, not systemic", status: "intact", why: "mock" }
        ],
        calendar: [],
        narrative_vs_evidence_gaps: [
          {
            gap: `${first ? first.ticker : "the tape"}: crowd vs price`,
            consensus_says: "the move is over",
            tape_says: "the level is quietly holding",
            strength: 3
          }
        ],
        not_observable: [{ field: "peers/macro/crypto", reason: "mock run — no live data" }],
        _openTickers: openTickers
      };
    },
    text: () =>
      [
        "THE LEVEL THAT WON'T BREAK",
        "",
        "Everyone wrote it off. The tape did not.",
        "",
        "This is a mock article generated offline to exercise the chain. No live",
        "numbers were used. Replace by running with a real model key.",
        "",
        "Proof, not hype.",
        "",
        "@TheBenchTrades",
        "",
        "Not financial advice. Educational only."
      ].join("\n")
  };
}

async function present({ verdict, archiveBlock, article, angle, lint }) {
  const out = [];
  out.push("================ THE BENCH — DAILY RUN ================");
  out.push(`regime: ${verdict.regime} · market risk: ${verdict.market_risk}`);
  out.push("");
  out.push("US READ: " + verdict.us_read);
  out.push("PEER READ: " + verdict.global_peer_read);
  out.push("");
  out.push(archiveBlock);
  out.push("");
  if (!angle.angle) {
    out.push("▦ STORY");
    out.push(angle.caption);
  } else {
    out.push("▦ ANGLE: " + angle.angle);
    out.push("");
    out.push("▦ ARTICLE");
    out.push(article);
    out.push("");
    out.push(
      `▦ LINT: ${lint.ok ? "PASS" : "FAIL"} · ${lint.charCount} chars · ${lint.emDashes} em-dashes` +
        (lint.ok ? "" : "\n  " + lint.flags.map((f) => `[${f.rule}] ${f.detail}`).join("\n  "))
    );
  }
  out.push("");
  out.push("(draft only — nothing is posted)");
  out.push("======================================================");
  return out.join("\n");
}

export async function run({ mock = false, dumpJson = false } = {}) {
  const archive = loadArchive();

  // 1. Data packet
  const { packet, quotes } = await buildDataPacket(archive, { mock });

  // 2. Providers + prompts
  const benchProvider = mock ? "mock" : providerFor("bench");
  const marqueeProvider = mock ? "mock" : providerFor("marquee");
  const mm = mockModel(packet);

  // 3. callBench
  const benchUser =
    "MATERIAL (data packet):\n" +
    JSON.stringify(packet, null, 2) +
    "\n\nReturn ONLY the structured verdict. Every unverifiable input must appear in `not_observable` — never dropped, never guessed.";
  const verdict = await callStructured(
    { system: loadBenchPrompt(), user: benchUser, schema: benchResponseSchema },
    { provider: benchProvider, mock: mock ? mm : undefined }
  );
  if (dumpJson) console.log("---- VERDICT JSON ----\n" + JSON.stringify(verdict, null, 2) + "\n----------------------");

  // 4. reconcileArchive — HALT on failure (no article against an unreconciled board)
  const stamp = verdict.review_stamp || packet.review_stamp;
  let recon;
  try {
    const engine = mock ? "gpt-runner" : engineTag(benchProvider);
    recon = reconcile(archive, quotes, verdict.board || [], engine, stamp);
  } catch (err) {
    console.error("HALT — reconcileArchive failed: " + err.message);
    console.error("No article written. The board is unreconciled.");
    process.exitCode = 1;
    return;
  }
  const archiveBlock = renderArchiveBlock(recon, stamp);

  // 5. selectAngle + No-Story Rule
  const openTickers = archive.filter(isOpen).map((r) => r.ticker);
  const angle = selectAngle(verdict, { openTickers, calendar: verdict.calendar || [] });

  // 6. callMarquee (only if there's a story)
  let article = null;
  let lint = null;
  if (angle.angle) {
    const marqueeUser =
      "MATERIAL:\n" +
      JSON.stringify(verdict, null, 2) +
      "\n\nARCHIVE (reconciled today):\n" +
      archiveBlock +
      "\n\nANGLE / THESIS:\n" +
      angle.angle +
      "\n\nLENGTH: 600-650 words (<= 3,900 characters). Every number must appear in MATERIAL. " +
      "Anything in not_observable is labeled unverified or omitted.";
    article = await callText(
      { system: loadMarqueePrompt(), user: marqueeUser },
      { provider: marqueeProvider, mock: mock ? mm : undefined }
    );
    lint = lintArticle(article);
  }

  // 7. present — never post
  const text = await present({ verdict, archiveBlock, article, angle, lint });
  return { text, verdict, archiveBlock, article, angle, lint };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  run({ mock: args.includes("--mock"), dumpJson: args.includes("--json") })
    .then((r) => {
      if (r && r.text) console.log(r.text);
    })
    .catch((err) => {
      console.error("RUN FAILED: " + err.message);
      process.exitCode = 1;
    });
}
