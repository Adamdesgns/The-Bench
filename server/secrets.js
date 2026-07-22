// secrets.js — LOCAL-ONLY model API keys.
//
// Model provider keys (Claude / OpenAI) are stored in db/secrets.local.json on
// THIS machine only: gitignored, never committed, never transmitted anywhere
// except to the provider's own API. This is how a desktop app holds your key.
//
// Broker / execution credentials (Robinhood) NEVER live here — those go through
// the MCP server. This file is model keys only.

import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Standalone path calc (no import from config.js — avoids a circular import).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PATH = resolve(ROOT, "db/secrets.local.json");

function load() {
  try { return JSON.parse(readFileSync(PATH, "utf8")); } catch { return {}; }
}

export function getSecret(name) {
  return load()[name] || null;
}

export function setSecret(name, value) {
  const o = load();
  if (value) o[name] = value; else delete o[name];
  writeFileSync(PATH, JSON.stringify(o, null, 2) + "\n");
  try { chmodSync(PATH, 0o600); } catch { /* best effort perms */ }
  return true;
}

// Booleans only — safe to send to the UI. Never returns the key values.
export function secretStatus() {
  const o = load();
  return { anthropic: Boolean(o.ANTHROPIC_API_KEY), openai: Boolean(o.OPENAI_API_KEY) };
}
