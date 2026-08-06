// mcp.js — THE BENCH MCP server.
//
// This is the integration boundary Hermes Agent drives. It exposes the v17 →
// Marquee chain (plus the gated execute path) as MCP tools over stdio. Hermes
// prompts these tools; the server does the real work and holds any downstream
// connection (Robinhood). No secrets are returned to the caller.
//
// Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout (MCP stdio spec).
// Dependency-free on purpose — Hermes just needs a stdio MCP server to spawn.
//
//   Tools:
//     run_v17({target})      analysis — data packet (+ verdict if a model is connected)
//     reconcile()            price every open row; report the reconciled board
//     run_marquee({verdict}) the draft (never posts); lint included
//     lint_chain({text})     house-style check on a chain draft before it publishes
//     state()                the book — open triggers, calibration, engine mix
//     execute({order,confirmToken})  GATED buy — routes to Robinhood MCP; refuses unless policy allows
//
// Run: node server/mcp.js   (or `npm run mcp`)

import { loadArchive, isOpen } from "./reconcile.js";
import { getQuote, getDailyCloses, avRemaining, NOT_OBSERVABLE } from "./dataProviders.js";
import { computeIndicators } from "./indicators.js";
import { callStructured, callText, engineTag } from "./llm.js";
import { providerFor } from "./config.js";
import { benchResponseSchema } from "./reviewSchema.js";
import { loadBenchPrompt, loadMarqueePrompt } from "./benchPrompt.js";
import { selectAngle } from "./angle.js";
import { lintArticle, lintChain } from "./lint.js";
import { executeOrder } from "./api.js";
import { status } from "./settings.js";
import { audited } from "./audit.js";

const SERVER_INFO = { name: "the-bench", version: "0.1.0" };
const PROTOCOL = "2025-06-18";
const round = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
const log = (...a) => process.stderr.write("[bench-mcp] " + a.join(" ") + "\n"); // stderr only — stdout is the protocol channel

// ── data packet (real prices + indicators; unfetchable => "not observable") ──
async function pricedRow(ticker) {
  const q = await getQuote(ticker).catch(() => null);
  const hist = await getDailyCloses(ticker).catch(() => ({ closes: [] }));
  const ind = hist.closes && hist.closes.length >= 30 ? computeIndicators(hist.closes) : null;
  return {
    ticker,
    last: q && typeof q.price === "number" ? q.price : NOT_OBSERVABLE,
    source: q ? q.source : "none",
    provisional: q ? q.provisional : true,
    indicators: ind
      ? { rsi14: round(ind.rsi14), sma50: round(ind.sma50), sma200: round(ind.sma200), trend_strength: ind.trend_strength }
      : NOT_OBSERVABLE
  };
}

async function buildPacket(target) {
  const archive = loadArchive();
  const open = archive.filter(isOpen);
  const names =
    !target || target.toLowerCase() === "market"
      ? open.map((r) => r.ticker)
      : [target.toUpperCase()];
  const board = [];
  for (const t of names) board.push(await pricedRow(t));
  return {
    review_stamp: new Date().toISOString(),
    mode: "Research / Battle-Test Mode",
    target: target || "market",
    board,
    av_calls_remaining: avRemaining(),
    note: "Every value not fetched live is the literal string 'not observable'."
  };
}

// ── tool implementations ──
const TOOLS = {
  run_v17: {
    description: "Run THE BENCH v17 analysis for a ticker (e.g. \"GOOGL\") or \"market\". Returns a live data packet; adds the structured verdict when a model connection is configured.",
    inputSchema: { type: "object", properties: { target: { type: "string", description: "ticker symbol or 'market'" } } },
    async run({ target } = {}) {
      const packet = await buildPacket(target);
      const provider = providerFor("bench");
      if (!provider) return { packet, verdict: null, model_connection: "none — connect Claude/OpenAI" };
      const user =
        "MATERIAL (data packet):\n" + JSON.stringify(packet, null, 2) +
        "\n\nReturn ONLY the structured verdict. Every unverifiable input must appear in `not_observable`.";
      const verdict = await callStructured(
        { system: loadBenchPrompt(), user, schema: benchResponseSchema },
        { provider }
      );
      return { packet, verdict, engine: engineTag(provider) };
    }
  },

  reconcile: {
    description: "Walk the open board and price every row (v17 §2.5). A row with no fresh print is marked unverified. Returns the reconciled view; never carries a stale number forward.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      const archive = loadArchive();
      const open = archive.filter(isOpen);
      const rows = [];
      for (const r of open) {
        const q = await getQuote(r.ticker).catch(() => null);
        rows.push({
          id: r.id, ticker: r.ticker, review_price: r.review_price,
          last: q && typeof q.price === "number" ? q.price : "unverified",
          source: q ? q.source : "none", state: r.final_call
        });
      }
      return { stamp: new Date().toISOString(), open_rows: rows.length, rows };
    }
  },

  run_marquee: {
    description: "Turn a v17 verdict into the six-part draft (headlines, dek, hero, article, pull quotes, companion post). Ends at a draft — never posts. Returns lint results (char count, em-dash cap, banned phrases, boilerplate).",
    inputSchema: {
      type: "object",
      properties: { verdict: { type: "object", description: "the v17 verdict JSON" }, angle: { type: "string", description: "optional ANGLE override" } },
      required: ["verdict"]
    },
    async run({ verdict, angle } = {}) {
      const provider = providerFor("marquee");
      if (!provider) return { draft: null, model_connection: "none — connect Claude/OpenAI" };
      const chosen = angle || selectAngle(verdict).angle;
      if (!chosen) return { draft: null, no_story: "No story today — the board is unchanged." };
      const user =
        "MATERIAL:\n" + JSON.stringify(verdict, null, 2) +
        "\n\nANGLE / THESIS:\n" + chosen +
        "\n\nLENGTH: 600-650 words (<= 3,900 characters). Every number must appear in MATERIAL. " +
        "Anything in not_observable is labeled unverified or omitted.";
      const draft = await callText({ system: loadMarqueePrompt(), user }, { provider });
      return { angle: chosen, draft, lint: lintArticle(draft), engine: engineTag(provider) };
    }
  },

  lint_chain: {
    description: "Check a Bench chain draft against house style before it publishes: 3-6 parts split by '---', each part under 280 chars (URLs counted as 23), zero em dashes, a checkable number in the hook, no question as the hook, no banned phrases or generic openers, no engagement bait, max 2 hashtags, disclaimer on the last part. Returns hard flags (blocking) and warnings (advisory). Checks text only — posts nothing.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "the full chain draft, parts separated by exactly three dashes alone on a line" } },
      required: ["text"]
    },
    async run({ text } = {}) {
      const r = lintChain(text);
      return {
        ok: r.ok,
        flags: r.flags,
        warnings: r.warnings,
        parts: r.parts.map((p) => ({ part: p.index, chars: p.chars, effective: p.effective }))
      };
    }
  },

  state: {
    description: "The book: open triggers, closed rows, calibration buckets, engine mix. Read-only.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      const a = loadArchive();
      const open = a.filter(isOpen);
      const closed = a.filter((r) => r.outcome);
      const isLive = (r) => /ARMED|Setup Forming|Watchlist|Top watchlist|Hedge/i.test(r.final_call || "");
      const engineMix = a.reduce((m, r) => ((m[r.engine] = (m[r.engine] || 0) + 1), m), {});
      const wins = closed.filter((r) => r.outcome === "Win").length;
      return {
        rows: a.length,
        open: open.length,
        closed: closed.length,
        win_rate: closed.length ? Math.round((100 * wins) / closed.length) : null,
        live_triggers: open.filter(isLive).map((r) => ({ id: r.id, ticker: r.ticker, trigger: r.final_call })),
        engine_mix: engineMix,
        calibration: { note: "aggregate only; meaningful near 30 closes", closed: closed.length }
      };
    }
  },

  execute: {
    description: "GATED buy. Routes to the Robinhood MCP and honors the execution policy (paper default, kill switch, per-trade/daily caps, confirm-before-buy). Refuses unless connected + live + not killed (+ confirm token). Analysis tools never call this — an agent does, when a trigger fires.",
    inputSchema: {
      type: "object",
      properties: {
        order: {
          type: "object",
          properties: { ticker: { type: "string" }, side: { type: "string", enum: ["buy", "sell"] }, usd: { type: "number" }, limit: { type: "number" } },
          required: ["ticker", "side"]
        },
        confirmToken: { type: "string", description: "required when confirm-before-buy is on" }
      },
      required: ["order"]
    },
    async run({ order, confirmToken } = {}) {
      return executeOrder(order, confirmToken);
    }
  }
};

// ── JSON-RPC / MCP wiring ──
function reply(id, result) { write({ jsonrpc: "2.0", id, result }); }
function replyError(id, code, message) { write({ jsonrpc: "2.0", id, error: { code, message } }); }
function write(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: params?.protocolVersion || PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: "THE BENCH — v17 analysis → Marquee draft, with a gated execute path. Drafts never post; buys are policy-gated and route through the Robinhood MCP."
    });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return; // no response to notifications
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") {
    return reply(id, {
      tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema }))
    });
  }
  if (method === "tools/call") {
    const name = params?.name;
    const t = TOOLS[name];
    if (!t) return replyError(id, -32602, `unknown tool: ${name}`);
    const args = params.arguments || {};
    const actor = args._actor || "hermes"; // MCP calls are agent-driven
    try {
      // Every tool call is audited (append-only, hash-chained). execute derives
      // allowed/refused from its own gate result; others log as n/a.
      const out = await audited(
        { actor, kind: name, target: args.target ?? args.order?.ticker ?? null, input: args, decision: name === "execute" ? undefined : "n/a" },
        () => t.run(args)
      );
      const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
      return reply(id, { content: [{ type: "text", text }], isError: false });
    } catch (err) {
      log("tool error:", name, err.message);
      return reply(id, { content: [{ type: "text", text: "error: " + err.message }], isError: true });
    }
  }
  if (id !== undefined) return replyError(id, -32601, `method not found: ${method}`);
}

// stdin: newline-delimited JSON
let buf = "";
const inflight = new Set();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { log("bad json:", line.slice(0, 120)); continue; }
    const p = Promise.resolve(handle(msg)).catch((e) => log("handler error:", e.message));
    inflight.add(p); p.finally(() => inflight.delete(p));
  }
});
// On shutdown, let in-flight tool calls finish (so their audit lines flush).
process.stdin.on("end", async () => { await Promise.allSettled([...inflight]); process.exit(0); });
log(`ready — ${Object.keys(TOOLS).length} tools on stdio`);
