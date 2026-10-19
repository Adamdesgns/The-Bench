// benny-ask.test.mjs — the Q&A core: only Adam gets answers, and the session can only see read-only tools. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_TOOLS, ALLOWED_MCP, DENIED_TOOLS, checkTools, buildClaudeArgs, parseStream,
  shouldAnswer, commandOf, answersToday, composeAnswer, askerOf, framedQuestion, secretLeaks,
} from "../benny/ask.mjs";
import { SIGN_OFF } from "../scripts/benny-post.mjs";

const ADAM = "111";
const msg = (o = {}) => ({ content: "What is the stop on B-906?", author: { id: ADAM, bot: false }, channel: { name: "ask-benny" }, ...o });

test("only Adam, only a human, only in #ask-benny gets an answer", () => {
  assert.equal(shouldAnswer(msg(), ADAM), true);
  assert.equal(shouldAnswer(msg({ author: { id: "222", bot: false } }), ADAM), false);
  assert.equal(shouldAnswer(msg({ author: { id: ADAM, bot: true } }), ADAM), false);
  assert.equal(shouldAnswer(msg({ channel: { name: "lesson" } }), ADAM), false);
  assert.equal(shouldAnswer(msg(), ""), false);
});

test("the allowlist is exactly Read, Grep, Glob and four read-only Robinhood tools", () => {
  assert.deepEqual(ALLOWED_TOOLS, ["Read", "Grep", "Glob",
    "mcp__robinhood-trading__get_equity_quotes", "mcp__robinhood-trading__get_crypto_quotes",
    "mcp__robinhood-trading__get_equity_historicals", "mcp__robinhood-trading__get_earnings_calendar"]);
  assert.deepEqual(checkTools(ALLOWED_TOOLS), { ok: true, bad: [] });
});

test("any order, account or extra tool fails the check", () => {
  for (const t of ["Bash", "Write", "mcp__robinhood-trading__place_equity_order", "mcp__robinhood-trading__get_accounts", "mcp__robinhood-trading__get_portfolio"])
    assert.equal(checkTools([...ALLOWED_TOOLS, t]).ok, false, t);
});

test("every order and account tool is denied by name, no allowed tool is denied, the server is never named whole", () => {
  for (const t of ["place_equity_order", "place_option_order", "place_crypto_order", "cancel_equity_order", "get_accounts", "get_portfolio", "get_equity_positions", "get_equity_orders", "get_option_positions"])
    assert.ok(DENIED_TOOLS.includes(`mcp__robinhood-trading__${t}`), t);
  for (const t of ALLOWED_MCP) assert.ok(!DENIED_TOOLS.includes(t), t);
  const args = buildClaudeArgs({ persona: "P", mcpConfig: "benny/mcp.json" });
  assert.ok(!args.some((a) => a === "mcp__robinhood-trading" || a.split(",").includes("mcp__robinhood-trading") || a.includes("*")));
});

test("claude runs locked down: strict MCP config, built-in tools named, dontAsk, stream-json, no question in the args", () => {
  const args = buildClaudeArgs({ persona: "PERSONA", mcpConfig: "benny/mcp.json" });
  const at = (f) => args[args.indexOf(f) + 1];
  assert.ok(args.includes("-p"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(at("--mcp-config"), "benny/mcp.json");
  assert.equal(at("--tools"), "Read,Grep,Glob");
  assert.equal(at("--allowedTools"), ALLOWED_TOOLS.join(","));
  assert.equal(at("--disallowedTools"), DENIED_TOOLS.join(","));
  assert.equal(at("--permission-mode"), "dontAsk");
  assert.equal(at("--output-format"), "stream-json");
  assert.ok(args.includes("--verbose"));
  assert.equal(at("--append-system-prompt"), "PERSONA");
  assert.equal(at("--model"), "sonnet");
});

test("parseStream reads the init tool list and the result", () => {
  const out = [
    JSON.stringify({ type: "system", subtype: "init", tools: ["Read", "Grep"], mcp_servers: [{ name: "robinhood-trading", status: "connected" }] }),
    "not json",
    JSON.stringify({ type: "result", result: "The stop is 396 (B-906).", is_error: false, total_cost_usd: 0.02 }),
  ].join("\n");
  const s = parseStream(out);
  assert.deepEqual(s.tools, ["Read", "Grep"]);
  assert.equal(s.mcp[0].status, "connected");
  assert.equal(s.result, "The stop is 396 (B-906).");
  assert.equal(s.isError, false);
  assert.equal(parseStream("").init, null);
});

test("commands, the daily cap, and the sign-off", () => {
  assert.equal(commandOf("!halt"), "halt");
  assert.equal(commandOf("!Resume now"), "resume");
  assert.equal(commandOf("what is halt?"), null);
  const qa = { answers: [{ date: "2026-10-16", outcome: "ANSWERED" }, { date: "2026-10-16", outcome: "REFUSED" }, { date: "2026-10-15", outcome: "ANSWERED" }] };
  assert.equal(answersToday(qa, "2026-10-16"), 1);
  assert.equal(composeAnswer("Hi."), `Hi.\n\n${SIGN_OFF}`);
  assert.equal(composeAnswer(`Hi.\n\n${SIGN_OFF}`), `Hi.\n\n${SIGN_OFF}`);
});

const VAN = { name: "Van", discord_id: "333", daily_cap: 5 };

test("askers: Adam, a listed asker with their cap, nobody else; a null id is not active", () => {
  assert.deepEqual(askerOf(msg(), ADAM, [VAN]), { name: "Adam", adam: true });
  assert.deepEqual(askerOf(msg({ author: { id: "333", bot: false } }), ADAM, [VAN]), { name: "Van", adam: false, cap: 5 });
  assert.equal(askerOf(msg({ author: { id: "444", bot: false } }), ADAM, [VAN]), null);
  assert.equal(askerOf(msg({ author: { id: "333", bot: true } }), ADAM, [VAN]), null);
  assert.equal(askerOf(msg({ author: { id: "333", bot: false }, channel: { name: "lesson" } }), ADAM, [VAN]), null);
  assert.equal(askerOf(msg({ author: { id: "333", bot: false } }), ADAM, [{ ...VAN, discord_id: null }]), null);
  assert.equal(shouldAnswer(msg({ author: { id: "333", bot: false } }), ADAM), false);
});

test("a guest question is framed as not from the operator; Adam's is untouched", () => {
  assert.equal(framedQuestion("why?", { name: "Adam", adam: true }), "why?");
  assert.match(framedQuestion("why?", { name: "Van", adam: false }), /^Asked in #ask-benny by Van, a friend of my operator - not by my operator\.\n\nwhy\?$/);
});

test("daily counts are per asker; old rows with no asker are Adam's", () => {
  const qa = { answers: [
    { date: "2026-10-18", outcome: "ANSWERED" },
    { date: "2026-10-18", outcome: "ANSWERED", asker: "Adam" },
    { date: "2026-10-18", outcome: "ANSWERED", asker: "Van" },
    { date: "2026-10-18", outcome: "CAPPED", asker: "Van" },
    { date: "2026-10-17", outcome: "ANSWERED", asker: "Van" },
  ] };
  assert.equal(answersToday(qa, "2026-10-18", "Adam"), 2);
  assert.equal(answersToday(qa, "2026-10-18", "Van"), 1);
  assert.equal(answersToday(qa, "2026-10-18"), 3);
});

test("an answer carrying a Benny secret is caught, and the reason never repeats the value", () => {
  const secrets = { bot_token: ["MTIzNDU2Nzg5MDEyMzQ1Njc4OQ", "GaBcDe", "abcdefghijklmnopqrstuvwxyz0123456789"].join("."), // fake, built at runtime so secret scanners do not flag a literal, adam_user_id: "111",
    webhooks: { lesson: "https://discord.com/api/webhooks/123456/abcDEF-ghi" } };
  assert.deepEqual(secretLeaks("GOOGL is on the board at 312.40.", secrets), []);
  const tok = secretLeaks(`here: ${secrets.bot_token}`, secrets);
  assert.ok(tok.includes("a Discord bot token") && tok.includes("the bot_token setting"));
  assert.ok(secretLeaks("see https://discord.com/api/webhooks/999/zzz", {}).includes("a Discord webhook URL"));
  assert.ok(secretLeaks(`x ${secrets.webhooks.lesson}`, secrets).includes("the webhooks.lesson setting"));
  for (const r of tok) assert.ok(!r.includes(secrets.bot_token));
});
