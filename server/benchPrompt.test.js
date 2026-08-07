import test from "node:test";
import assert from "node:assert/strict";
import { loadBenchPrompt } from "./benchPrompt.js";

test("the workstation loads the current v23 framework", () => {
  const prompt = loadBenchPrompt();
  assert.match(prompt, /^# THE BENCH — v23/m);
  assert.match(prompt, /EXECUTION BOUNDARY/);
  assert.doesNotMatch(prompt, /^# THE BENCH — v17$/m);
});
