// settings.js — local, non-secret connection configuration for The Bench.
//
// The desktop app is a research workstation. It can use model providers and
// read-only data connections, but it exposes no order-routing capability.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { CONNECTIONS_PATH, hasKey } from "./config.js";

const DEFAULTS = {
  providers: {
    claude:    { label: "Claude",        kind: "model", enabled: true,  mcp: "" },
    openai:    { label: "OpenAI",        kind: "model", enabled: true,  mcp: "" },
    hermes:    { label: "Hermes Agents", kind: "agent", enabled: false, mcp: "" },
    robinhood: { label: "Robinhood",     kind: "data",  enabled: false, mcp: "" }
  }
};

function deepMerge(base, patch) {
  if (Array.isArray(base) || typeof base !== "object" || base === null) return patch ?? base;
  const out = { ...base };
  for (const key of Object.keys(patch || {})) out[key] = deepMerge(base[key], patch[key]);
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

const SECRET_RE = /key|secret|token|password|apikey/i;
function stripSecrets(value) {
  if (!value || typeof value !== "object") return value;
  const out = Array.isArray(value) ? [] : {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_RE.test(key)) continue;
    out[key] = typeof child === "object" ? stripSecrets(child) : child;
  }
  return out;
}

export function writeConnections(patch) {
  const safePatch = stripSecrets(patch || {});
  // Old connection files may contain the retired execution-policy object. Do
  // not propagate it into new writes; the app has no execution surface.
  delete safePatch.execution;
  const next = deepMerge(readConnections(), safePatch);
  delete next.execution;
  writeFileSync(CONNECTIONS_PATH, JSON.stringify(next, null, 2) + "\n");
  return next;
}

export function status() {
  const providers = readConnections().providers;
  return {
    providers: {
      claude: {
        label: providers.claude.label,
        kind: "model",
        enabled: providers.claude.enabled,
        connected: hasKey("anthropic") || Boolean(providers.claude.mcp),
        via: providers.claude.mcp ? "mcp" : (hasKey("anthropic") ? "local key" : "none")
      },
      openai: {
        label: providers.openai.label,
        kind: "model",
        enabled: providers.openai.enabled,
        connected: hasKey("openai") || Boolean(providers.openai.mcp),
        via: providers.openai.mcp ? "mcp" : (hasKey("openai") ? "local key" : "none")
      },
      hermes: {
        label: providers.hermes.label,
        kind: "agent",
        enabled: providers.hermes.enabled,
        connected: Boolean(providers.hermes.mcp),
        via: providers.hermes.mcp ? "mcp" : "none"
      },
      robinhood: {
        label: providers.robinhood.label,
        kind: "data",
        enabled: providers.robinhood.enabled,
        connected: Boolean(providers.robinhood.mcp),
        via: providers.robinhood.mcp ? "read-only mcp" : "none"
      }
    },
    capability: {
      mode: "research-only",
      canAnalyze: true,
      canDraft: true,
      canExecute: false,
      canPost: false
    },
    // Kept as a compatibility field for older clients; it is immutable false.
    canExecute: false
  };
}
