// benchPrompt.js — load the operating prompt files. v17 is the ONLY analysis
// version loaded; prompts/archive/ (v1-v16) is never touched here.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROMPTS_DIR } from "./config.js";

export function loadBenchPrompt() {
  return readFileSync(resolve(PROMPTS_DIR, "trading-copilot-v17.md"), "utf8");
}

export function loadMarqueePrompt() {
  return readFileSync(resolve(PROMPTS_DIR, "marquee-v3.1.md"), "utf8");
}
