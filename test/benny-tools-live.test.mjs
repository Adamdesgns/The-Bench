// benny-tools-live.test.mjs — runs a REAL `claude -p` with the listener's exact flags and proves what the
// session can see. Opt-in (BENNY_LIVE=1): it uses Adam's Claude subscription and the Robinhood connection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { buildClaudeArgs, parseStream, checkTools, ALLOWED_MCP } from "../benny/ask.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLAUDE = process.env.BENNY_CLAUDE || join(homedir(), ".local/bin/claude.exe");
const live = process.env.BENNY_LIVE === "1";

test("the live Benny session sees only the allowlisted tools, and Robinhood is connected",
  { skip: live ? false : "set BENNY_LIVE=1 to run against the real claude and Robinhood", timeout: 240000 }, () => {
    const out = execFileSync(CLAUDE, buildClaudeArgs({ persona: "Answer in one line.", mcpConfig: join(ROOT, "benny/mcp.json") }),
      { cwd: ROOT, input: "Name the tools you can use. Do not call any.", encoding: "utf8", timeout: 200000, maxBuffer: 8 * 1024 * 1024 });
    const s = parseStream(out);
    assert.ok(s.init, "no init message in the stream");
    const rh = s.mcp.find((x) => x.name === "robinhood-trading");
    assert.equal(rh?.status, "connected", `Robinhood is ${rh?.status ?? "absent"} - the quote tools would be missing`);
    assert.deepEqual(checkTools(s.tools).bad, [], `visible tools outside the allowlist: ${checkTools(s.tools).bad.join(", ")}`);
    for (const t of ALLOWED_MCP) assert.ok(s.tools.includes(t), `${t} is not visible`);
  });
