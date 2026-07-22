// audit.js — THE BENCH raw audit trail.
//
// Append-only, hash-chained record of every play the system CALLS (analysis) and
// MAKES (execution). Separate from the curated archive: the archive is one
// mutable row per setup; this is one immutable line per raw event, including
// every execute attempt — allowed AND refused.
//
// Integrity: each record carries prev_hash + hash, where
//   hash = sha256( canonical(record without hash) + prev_hash ).
// Edit or delete any line and verifyChain() flags the exact seq where the chain
// breaks. Committed to the repo, so git history is a second tamper-evidence
// layer. Proof, not hype.
//
// Files: db/audit/audit-YYYY-MM-DD.jsonl  +  db/audit/chain-tip.json (seq, hash)

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./config.js";

const AUDIT_DIR = resolve(ROOT, "db/audit");
const TIP_PATH = resolve(AUDIT_DIR, "chain-tip.json");
const GENESIS = "GENESIS";
const SECRET_RE = /key|secret|token|password|apikey|private/i;
const MAX_FIELD = 1200; // cap oversized input/output previews

function ensureDir() { if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, { recursive: true }); }
function iso(d = new Date()) { return d.toISOString(); }
function dayOf(ts) { return ts.slice(0, 10); }
function fileForDay(day) { return resolve(AUDIT_DIR, `audit-${day}.jsonl`); }

// Deterministic stringify (sorted keys) so the hash is stable.
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}

// Drop secret-looking keys; truncate oversized values.
function clean(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.length > MAX_FIELD ? { _truncated: v.length, preview: v.slice(0, MAX_FIELD) } : v;
  if (typeof v !== "object") return v;
  if (Array.isArray(v)) return v.slice(0, 40).map(clean);
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (SECRET_RE.test(k)) { out[k] = "[redacted]"; continue; }
    out[k] = clean(val);
  }
  return out;
}

function readTip() {
  try { return JSON.parse(readFileSync(TIP_PATH, "utf8")); } catch { return { seq: 0, hash: GENESIS }; }
}

// The one write path. Everything else is read-only.
export function appendAudit(evt = {}) {
  ensureDir();
  const tip = readTip();
  const ts = iso();
  const record = {
    seq: tip.seq + 1,
    ts,
    actor: evt.actor || "manual",       // hermes | manual | runner
    kind: evt.kind || "event",          // run_v17 | reconcile | run_marquee | execute | state | ...
    target: evt.target ?? null,
    input: clean(evt.input ?? null),
    output: clean(evt.output ?? null),
    decision: evt.decision || "n/a",    // allowed | refused | n/a
    reason: evt.reason ?? null,
    engine: evt.engine ?? null,
    provider: evt.provider ?? null,
    source: evt.source ?? null,
    mode: evt.mode ?? null,             // paper | live
    latency_ms: evt.latency_ms ?? null,
    prev_hash: tip.hash
  };
  record.hash = createHash("sha256").update(canonical(record) + tip.hash).digest("hex");
  appendFileSync(fileForDay(dayOf(ts)), JSON.stringify(record) + "\n");
  writeFileSync(TIP_PATH, JSON.stringify({ seq: record.seq, hash: record.hash }) + "\n");
  return record;
}

// Time a call and audit it. Returns the wrapped fn's result; never throws the
// audit itself (a logging failure must not break a trade decision path).
export async function audited(evt, fn) {
  const t0 = Date.now();
  let output, decision = evt.decision, reason = evt.reason, err;
  try {
    output = await fn();
    if (output && typeof output === "object" && "ok" in output && decision === undefined) {
      decision = output.ok ? "allowed" : "refused";
      reason = reason ?? output.reason;
    }
    return output;
  } catch (e) {
    err = e; decision = decision || "error"; reason = reason || e.message; throw e;
  } finally {
    try { appendAudit({ ...evt, output: err ? { error: err?.message } : evt.outputSummary?.(output) ?? summarize(output), decision, reason, latency_ms: Date.now() - t0 }); } catch { /* never break the caller */ }
  }
}

function summarize(v) {
  if (v == null || typeof v !== "object") return v;
  const s = JSON.stringify(v);
  return s.length > MAX_FIELD ? { keys: Object.keys(v), bytes: s.length } : v;
}

function allFiles() {
  ensureDir();
  return readdirSync(AUDIT_DIR).filter((f) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
}
function readLines(file) {
  try { return readFileSync(resolve(AUDIT_DIR, file), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
}

export function readAudit({ limit = 100, kind = null, day = null } = {}) {
  const files = day ? [`audit-${day}.jsonl`] : allFiles();
  let rows = [];
  for (const f of files) rows.push(...readLines(f));
  if (kind) rows = rows.filter((r) => r.kind === kind);
  rows.sort((a, b) => b.seq - a.seq); // newest first
  return rows.slice(0, limit);
}

// Recompute the whole chain from GENESIS across every day file.
export function verifyChain() {
  let prev = GENESIS, count = 0;
  for (const f of allFiles()) {
    for (const r of readLines(f)) {
      const { hash, ...body } = r;
      const expect = createHash("sha256").update(canonical(body) + prev).digest("hex");
      if (r.prev_hash !== prev || hash !== expect) return { ok: false, brokenAtSeq: r.seq, count };
      prev = hash; count++;
    }
  }
  return { ok: true, count };
}

export function exportCsv(day = null) {
  const rows = readAudit({ limit: 1e9, day });
  const cols = ["seq", "ts", "actor", "kind", "target", "decision", "reason", "engine", "provider", "source", "mode", "latency_ms", "hash"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.reverse().map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
