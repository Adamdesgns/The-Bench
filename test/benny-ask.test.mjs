// benny-ask.test.mjs — the Q&A core: only Adam gets answers, and the session can only see read-only tools. Offline only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_TOOLS, ALLOWED_MCP, DENIED_TOOLS, checkTools, buildClaudeArgs, parseStream,
  shouldAnswer, commandOf, answersToday, composeAnswer, askerOf, framedQuestion, secretLeaks,
  topicGate, TOPIC_RULES, OFF_TOPIC, OPERATOR_RULES, VOICE_RULES, operatorBody,
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

test("the allowlist is exactly Read, Grep, Glob, WebSearch and four read-only Robinhood tools", () => {
  assert.deepEqual(ALLOWED_TOOLS, ["Read", "Grep", "Glob", "WebSearch",
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
  const args = buildClaudeArgs({ persona: "P", mcpConfig: "benny/mcp.json", dataDir: "db" });
  assert.ok(!args.some((a) => a === "mcp__robinhood-trading" || a.split(",").includes("mcp__robinhood-trading") || a.includes("*")));
});

test("claude runs locked down: strict MCP config, built-in tools named, dontAsk, stream-json, no question in the args", () => {
  const args = buildClaudeArgs({ persona: "PERSONA", mcpConfig: "benny/mcp.json", dataDir: "db" });
  const at = (f) => args[args.indexOf(f) + 1];
  assert.ok(args.includes("-p"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(at("--mcp-config"), "benny/mcp.json");
  assert.equal(at("--tools"), "Read,Grep,Glob,WebSearch");
  assert.equal(at("--allowedTools"), ALLOWED_TOOLS.join(","));
  assert.equal(at("--disallowedTools"), DENIED_TOOLS.join(","));
  assert.equal(at("--permission-mode"), "dontAsk");
  assert.equal(at("--output-format"), "stream-json");
  assert.ok(args.includes("--verbose"));
  assert.ok(at("--append-system-prompt").startsWith("PERSONA"));
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

// Adam, 2026-10-21: "if I let you talk to other people it needs to be a strict conversation list.
// we're not shooting the shit. finances." Every session runs outside the repo with no settings files
// (so no CLAUDE.md, no memory, no git), reads only db/, and must tag its answer on or off topic.
test("each answer session runs with no settings files, reads only the data folder, and carries the topic rules", () => {
  const args = buildClaudeArgs({ persona: "PERSONA", mcpConfig: "m.json", dataDir: "C:/bench/db" });
  const at = (f) => args[args.indexOf(f) + 1];
  assert.equal(at("--setting-sources"), "");
  assert.equal(at("--add-dir"), "C:/bench/db");
  assert.ok(at("--append-system-prompt").startsWith("PERSONA"));
  assert.ok(at("--append-system-prompt").includes(TOPIC_RULES));
  assert.throws(() => buildClaudeArgs({ persona: "P", mcpConfig: "m.json" }), /dataDir/);
});

test("the topic gate: on-topic loses its tag, off-topic gets the fixed line, no tag is refused", () => {
  assert.deepEqual(topicGate("[ON-TOPIC] NVDA closed at 182.40."), { ok: true, body: "NVDA closed at 182.40." });
  assert.deepEqual(topicGate("  [on-topic]\nA stop is a price where you get out."), { ok: true, body: "A stop is a price where you get out." });
  assert.deepEqual(topicGate("[OFF-TOPIC] Nice weather today!"), { ok: false, offTopic: true, body: OFF_TOPIC });
  const none = topicGate("Here. I'm Benny.");
  assert.equal(none.ok, false);
  assert.equal(none.offTopic, false);
  assert.match(none.reason, /tag/);
  assert.equal(topicGate("NVDA [ON-TOPIC] later in the text").ok, false);
  assert.ok(!/repo|file|branch/i.test(OFF_TOPIC));
});

// Adam, 2026-10-22: "I want every member of that discord chat to be able to ask 5 questions a day."
test("members: any human in #ask-benny gets the member cap; listed askers keep theirs; no member cap = old rule", () => {
  const who = (id, username, o = {}) => msg({ author: { id, username, bot: false }, ...o });
  assert.deepEqual(askerOf(who("444", "stranger"), ADAM, [VAN], 5), { name: "@stranger", adam: false, cap: 5, member: true });
  assert.deepEqual(askerOf(who("555", undefined), ADAM, [VAN], 5), { name: "@555", adam: false, cap: 5, member: true });
  assert.deepEqual(askerOf(who("333", "vanazadian_"), ADAM, [VAN], 5), { name: "Van", adam: false, cap: 5 });
  assert.deepEqual(askerOf(who(ADAM, "adam"), ADAM, [VAN], 5), { name: "Adam", adam: true });
  assert.equal(askerOf(who("444", "stranger"), ADAM, [VAN]), null);
  assert.equal(askerOf(who("444", "stranger"), ADAM, [VAN], 0), null);
  assert.equal(askerOf(msg({ author: { id: "444", username: "bot", bot: true } }), ADAM, [VAN], 5), null);
  assert.equal(askerOf(who("444", "stranger", { channel: { name: "lesson" } }), ADAM, [VAN], 5), null);
  // a member can never count against Adam's or a listed asker's cap: member names always start with @
  assert.notEqual(askerOf(who("444", "Adam"), ADAM, [VAN], 5).name, "Adam");
  assert.match(framedQuestion("why?", { name: "@stranger", adam: false, member: true }), /^Asked in #ask-benny by stranger, a member of the server - not by my operator\.\n\nwhy\?$/);
});

// Adam, 2026-10-22: "I just meant the 3 people in the chat now." Listed askers with no id yet match on
// their unique Discord username; an id, once set, is the only match.
test("a listed asker with a null id matches on username; with an id set, only the id counts", () => {
  const GRIM = { name: "Grim", discord_username: "ambassador_grim", discord_id: null, daily_cap: 5 };
  const who = (id, username) => msg({ author: { id, username, bot: false } });
  assert.deepEqual(askerOf(who("777", "ambassador_grim"), ADAM, [VAN, GRIM]), { name: "Grim", adam: false, cap: 5 });
  assert.deepEqual(askerOf(who("777", "Ambassador_Grim"), ADAM, [VAN, GRIM]), { name: "Grim", adam: false, cap: 5 });
  assert.equal(askerOf(who("777", "ambassador_grim2"), ADAM, [VAN, GRIM]), null);
  assert.equal(askerOf(who("777", undefined), ADAM, [VAN, GRIM]), null);
  assert.equal(askerOf(who("888", "ambassador_grim"), ADAM, [VAN, { ...GRIM, discord_id: "777" }]), null);
  assert.equal(askerOf(who("999", "someone_new"), ADAM, [VAN, GRIM], 0), null);
});

// Adam, 2026-10-22, after the audit: "He needs to respond like I do and when I ask him something he give
// me what I need as long as it's not illegal." Adam gets the operator rules (any legal topic, any
// ticker, his real read) with no topic gate; guests keep the finance-only list. Everyone gets the voice.
test("Adam's session carries the operator rules and no tag demand; a guest's carries the topic list; both carry the voice", () => {
  const rules = (operator) => {
    const a = buildClaudeArgs({ persona: "P", mcpConfig: "m.json", dataDir: "db", operator });
    return a[a.indexOf("--append-system-prompt") + 1];
  };
  assert.ok(rules(true).includes(OPERATOR_RULES) && rules(true).includes(VOICE_RULES));
  assert.ok(!rules(true).includes(TOPIC_RULES));
  assert.ok(rules(false).includes(TOPIC_RULES) && rules(false).includes(VOICE_RULES));
  assert.ok(!rules(false).includes(OPERATOR_RULES));
  assert.ok(rules().includes(TOPIC_RULES), "operator defaults to false");
  assert.match(OPERATOR_RULES, /not on the board|any ticker/i);
  assert.match(TOPIC_RULES, /airdrop/i);
  // Adam, 2026-10-22: "I want him giving them picks based on facts ... Then I decide."
  assert.match(TOPIC_RULES, /my read, not on the book/);
  assert.match(TOPIC_RULES, /Never tell them to buy/);
});

test("an operator answer loses a stray tag and is never turned into the off-topic line", () => {
  assert.equal(operatorBody("[ON-TOPIC] BTC is down 2%."), "BTC is down 2%.");
  assert.equal(operatorBody("[OFF-TOPIC]\nSure, the setting is in Discord."), "Sure, the setting is in Discord.");
  assert.equal(operatorBody("No tag here."), "No tag here.");
});
