// settings.js — connection config for THE BENCH app.
//
// CRITICAL: no secrets live here or in the file this writes. Model and broker
// credentials are held by the MCP servers / the host environment, never by this
// app. This layer stores only NON-SECRET connection references: which MCP
// endpoint each provider points at, whether it's enabled, and the execution
// policy. db/connections.json is gitignored.
//
// Providers:
//   claude    (model, MCP or host key)      — v17 / Marquee analysis
//   openai    (model, MCP or host key)      — v17 / Marquee analysis
//   hermes    (agent, MCP)                  — task-runner agents
//   robinhood (execution, MCP)              — order placement (buys)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { CONNECTIONS_PATH, hasKey } from "./config.js";

const DEFAULTS = {
  providers: {
    claude:    { label: "Claude",        kind: "model",     mcp: "", enabled: true },
    openai:    { label: "OpenAI",        kind: "model",     mcp: "", enabled: true },
    hermes:    { label: "Hermes Agents", kind: "agent",     mcp: "", enabled: false },
    robinhood: { label: "Robinhood",     kind: "execution", mcp: "", enabled: false }
  },
  // Execution policy — safe defaults. Buys require ALL of: enabled robinhood
  // connection, mode=live, killSwitch off, and (if confirmBeforeBuy) a human ok.
  execution: {
    mode: "paper",           // paper | live
    confirmBeforeBuy: true,  // require explicit confirm per order
    perTradeCapUsd: 150,     // matches the v17 aggressive risk band
    dailyCapUsd: 500,
    killSwitch: false        // true = block ALL orders immediately
  }
};

function deepMerge(base, patch) {
  if (Array.isArray(base) || typeof base !== "object" || base === null) return patch ?? base;
  const out = { ...base };
  for (const k of Object.keys(patch || {})) out[k] = deepMerge(base[k], patch[k]);
  return out;
}

export function readConnections() {
  if (!existsSync(CONNECTIONS_PATH)) return structuredClone(DEFAULTS);
  try {
    return deepMerge(DEFAULTS, JSON.parse(readFileSync(CONNECTIONS_PATH, "utf8")));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

// Merge a patch and persist. Silently drops any key that looks like a secret —
// this file must never carry credentials.
const SECRET_RE = /key|secret|token|password|apikey/i;
function stripSecrets(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_RE.test(k)) continue;
    out[k] = typeof v === "object" ? stripSecrets(v) : v;
  }
  return out;
}

export function writeConnections(patch) {
  const next = deepMerge(readConnections(), stripSecrets(patch || {}));
  writeFileSync(CONNECTIONS_PATH, JSON.stringify(next, null, 2) + "\n");
  return next;
}

// Public status — safe to send to the client. Booleans only, never values.
export function status() {
  const c = readConnections();
  const p = c.providers;
  return {
    providers: {
      claude:    { label: p.claude.label,    kind: "model",     enabled: p.claude.enabled,    connected: hasKey("anthropic") || !!p.claude.mcp,    via: p.claude.mcp ? "mcp" : (hasKey("anthropic") ? "host-env" : "none") },
      openai:    { label: p.openai.label,    kind: "model",     enabled: p.openai.enabled,    connected: hasKey("openai")    || !!p.openai.mcp,    via: p.openai.mcp ? "mcp" : (hasKey("openai") ? "host-env" : "none") },
      hermes:    { label: p.hermes.label,    kind: "agent",     enabled: p.hermes.enabled,    connected: !!p.hermes.mcp,    via: p.hermes.mcp ? "mcp" : "none" },
      robinhood: { label: p.robinhood.label, kind: "execution", enabled: p.robinhood.enabled, connected: !!p.robinhood.mcp, via: p.robinhood.mcp ? "mcp" : "none" }
    },
    execution: c.execution,
    // Buys are only possible when every gate is satisfied.
    canExecute: c.providers.robinhood.enabled && !!c.providers.robinhood.mcp &&
                c.execution.mode === "live" && !c.execution.killSwitch
  };
}
