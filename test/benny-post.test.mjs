// benny-post.test.mjs — the only door to Discord refuses what it must. Offline: fetch is faked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postBenny, splitForDiscord, SIGN_OFF } from "../scripts/benny-post.mjs";

const NOW = new Date("2026-10-16T20:00:00Z");
const HOOK = "https://discord.test/api/webhooks/1/abc";

function setup({ mode = "live" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "benny-root-"));
  const home = mkdtempSync(join(tmpdir(), "benny-home-"));
  mkdirSync(join(root, "db")); mkdirSync(join(root, "docs")); mkdirSync(join(root, "benny"));
  writeFileSync(join(root, "db/benny-config.json"), JSON.stringify({ mode, start_balance: 10000, risk_pct: null, daily_answer_cap: 20 }));
  writeFileSync(join(home, "wall.json"), JSON.stringify({ asof: "2026-10-16T13:00:00Z", amounts: [3512.31], holdings: [{ sym: "GOOGL", shares: 8, cost: 336.25 }] }));
  writeFileSync(join(home, "discord.json"), JSON.stringify({ webhooks: { lesson: HOOK, morning: HOOK }, bot_token: "", adam_user_id: "" }));
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 204 }; };
  const post = (name, text, extra = {}) => {
    writeFileSync(join(root, "docs", name), text);
    return postBenny({ channel: "lesson", file: `docs/${name}`, root, home, fetchImpl, now: NOW, ...extra });
  };
  const log = () => JSON.parse(readFileSync(join(root, "db/benny-posts.json"), "utf8")).posts;
  return { root, home, calls, post, log };
}
const CLEAN = `A stop-loss caps the loss. B-906 has its stop at 396.\n\n${SIGN_OFF}`;

test("a clean post in live mode goes to the channel webhook and is logged SENT", async () => {
  const s = setup();
  const r = await s.post("a.md", CLEAN);
  assert.equal(r.outcome, "SENT");
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, HOOK);
  const body = JSON.parse(s.calls[0].opts.body);
  assert.equal(body.content, CLEAN);
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.equal(s.log()[0].outcome, "SENT");
});

test("dry mode sends to the phone titled BENNY DRY RUN, never to Discord", async () => {
  const s = setup({ mode: "dry" });
  const r = await s.post("a.md", CLEAN);
  assert.equal(r.outcome, "DRY");
  assert.ok(s.calls.every((c) => c.url.startsWith("https://ntfy.sh/")));
  assert.match(s.calls[0].opts.headers.Title, /^BENNY DRY RUN - lesson/);
});

test("a missing sign-off is refused, Adam is pinged, and the refusal is logged", async () => {
  const s = setup();
  const r = await s.post("a.md", "No sign-off here.");
  assert.equal(r.outcome, "REFUSED");
  assert.match(r.reasons.join(" "), /sign-off/);
  assert.equal(s.calls.length, 1);
  assert.match(s.calls[0].url, /ntfy\.sh/);
  assert.equal(s.log()[0].outcome, "REFUSED");
});

test("placeholders are refused", async () => {
  const s = setup();
  for (const p of ["TBD", "TODO", "{{price}}", "XX.XX"]) {
    const r = await s.post(`p-${p.length}.md`, `Level ${p}.\n\n${SIGN_OFF}`);
    assert.equal(r.outcome, "REFUSED", p);
  }
});

test("the same file, or the same text under another file, is refused the second time", async () => {
  const s = setup();
  assert.equal((await s.post("a.md", CLEAN)).outcome, "SENT");
  assert.equal((await s.post("a.md", CLEAN)).outcome, "REFUSED");
  assert.equal((await s.post("b.md", CLEAN)).outcome, "REFUSED");
});

test("benny/HALT stops everything", async () => {
  const s = setup();
  writeFileSync(join(s.root, "benny/HALT"), "halt");
  const r = await s.post("a.md", CLEAN);
  assert.equal(r.outcome, "REFUSED");
  assert.match(r.reasons.join(" "), /HALT/);
});

test("a wall failure is refused and the committed log never carries the real value", async () => {
  const s = setup();
  const r = await s.post("a.md", `Equity is 3,512.31 today.\n\n${SIGN_OFF}`);
  assert.equal(r.outcome, "REFUSED");
  assert.ok(!readFileSync(join(s.root, "db/benny-posts.json"), "utf8").includes("3,512.31"));
  assert.ok(!readFileSync(join(s.root, "db/benny-posts.json"), "utf8").includes("3512"));
});

test("--dry-run sends nothing and logs nothing", async () => {
  const s = setup();
  const r = await s.post("a.md", CLEAN, { dryRun: true });
  assert.equal(r.outcome, "WOULD-SEND");
  assert.equal(s.calls.length, 0);
  assert.ok(!existsSync(join(s.root, "db/benny-posts.json")));
});

test("a long post splits into numbered parts of at most 2,000 characters", () => {
  const para = "word ".repeat(300).trim();
  const parts = splitForDiscord([para, para, para, para].join("\n\n"));
  assert.ok(parts.length >= 3);
  parts.forEach((p, i) => { assert.ok([...p].length <= 2000); assert.ok(p.startsWith(`(${i + 1}/${parts.length}) `)); });
  assert.deepEqual(splitForDiscord("short"), ["short"]);
});
