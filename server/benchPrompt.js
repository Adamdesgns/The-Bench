// benchPrompt.js — load the current operating prompt files.
// Prompt versions are immutable; the workstation explicitly runs v23.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROMPTS_DIR } from "./config.js";

export function loadBenchPrompt() {
  return readFileSync(resolve(PROMPTS_DIR, "trading-copilot-v23.md"), "utf8");
}

export function loadMarqueePrompt() {
  return readFileSync(resolve(PROMPTS_DIR, "marquee-v3.1.md"), "utf8");
}
