// config.js — environment + provider resolution. No secrets live here; only
// the logic that reads them from process.env (loaded from .env via dotenv).

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");
export const ARCHIVE_PATH = resolve(ROOT, "db/archive.json");
export const PROMPTS_DIR = resolve(ROOT, "prompts");
// Non-secret connection config (MCP endpoints, enabled flags, execution policy).
// NEVER holds API keys or brokerage credentials. Gitignored.
export const CONNECTIONS_PATH = resolve(ROOT, "db/connections.json");

// Load .env if present (dotenv is a dependency; optional at runtime).
try {
  if (existsSync(resolve(ROOT, ".env"))) {
    const dotenv = await import("dotenv");
    dotenv.config({ path: resolve(ROOT, ".env") });
  }
} catch {
  // dotenv not installed — rely on the ambient environment.
}

const env = process.env;

// Default model IDs per provider. Override with OPENAI_MODEL / ANTHROPIC_MODEL.
export const DEFAULT_MODELS = {
  openai: env.OPENAI_MODEL || "gpt-4o",
  anthropic: env.ANTHROPIC_MODEL || "claude-sonnet-5"
};

export const ENGINE_TAG = { openai: "gpt-runner", anthropic: "claude" };

export function hasKey(provider) {
  if (provider === "openai") return Boolean(env.OPENAI_API_KEY);
  if (provider === "anthropic") return Boolean(env.ANTHROPIC_API_KEY);
  return false;
}

// Pick the default provider: explicit MODEL_PROVIDER wins; else whichever key
// is present (OpenAI first). Returns null if neither key is set.
export function defaultProvider() {
  const explicit = (env.MODEL_PROVIDER || "").trim().toLowerCase();
  if (explicit === "openai" || explicit === "anthropic") return explicit;
  if (hasKey("openai")) return "openai";
  if (hasKey("anthropic")) return "anthropic";
  return null;
}

// Resolve the provider for a given step ("bench" | "marquee").
export function providerFor(step) {
  const perStep = (env[`${step.toUpperCase()}_PROVIDER`] || "").trim().toLowerCase();
  if (perStep === "openai" || perStep === "anthropic") return perStep;
  return defaultProvider();
}

export const AV = {
  key: env.ALPHAVANTAGE_KEY || null,
  dailyBudget: Number(env.ALPHAVANTAGE_DAILY_BUDGET || 25)
};

export function keyFor(provider) {
  return provider === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY;
}
