// listener.mjs — ASK BENNY: answers questions in #ask-benny from Adam, the askers listed in
// db/benny-config.json (each under their own daily_cap), and every other member of the server under
// member_daily_cap free questions a day (counted by Discord id; 0 or unset turns members off). Never trades.
//
// For each question from Adam it runs a locked-down `claude -p` (see benny/ask.mjs), checks the
// session's own tool list, appends the fixed sign-off, runs the wall check, and only then posts.
// Any failure posts a short non-answer and pings Adam's phone with the reason. An answer that carries
// a Benny secret (bot token, webhook URL) is refused like a wall failure.
// !halt writes benny/HALT (stops every post and answer); !resume removes it - Adam only. Adam gets at
// most daily_answer_cap answers a day, each asker their own daily_cap. Every question is logged to db/benny-qa.json.
// Settings: ~/.benny/discord.json (bot_token, adam_user_id) - never committed, never printed.
// Started by benny/run-listener.ps1. Spec: docs/superpowers/specs/2026-10-15-benny-discord-bot-design.md

import { Client, Events, GatewayIntentBits } from "discord.js";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildClaudeArgs, checkTools, parseStream, askerOf, framedQuestion, commandOf, answersToday, memberQuestionsToday, memberCapMessage, composeAnswer, secretLeaks, topicGate } from "./ask.mjs";
import { checkWall, loadWall, bennyHome, internalsLeaks } from "../scripts/benny-wall.mjs";
import { splitForDiscord, ntfyPing } from "../scripts/benny-post.mjs";
import { nyDate } from "../scripts/paper-book.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HALT = join(ROOT, "benny/HALT");
const QA = join(ROOT, "db/benny-qa.json");
const CLAUDE = process.env.BENNY_CLAUDE || join(homedir(), ".local/bin/claude.exe");
const NO_ANSWER = "Not answering this one. My operator has been told why.";
// Answer sessions run here, outside the repo, so they never see its CLAUDE.md or git (2026-10-21).
const WORK = join(bennyHome(), "work");
mkdirSync(WORK, { recursive: true });

const secrets = JSON.parse(readFileSync(join(bennyHome(), "discord.json"), "utf8"));
const cfg = JSON.parse(readFileSync(join(ROOT, "db/benny-config.json"), "utf8"));
const persona = readFileSync(join(ROOT, cfg.persona), "utf8");
const askers = cfg.askers || [];
const memberCap = Number(cfg.member_daily_cap) || 0;
// A member's questions still being answered, by Discord id. A run takes a while and the row is written
// at the end, so without this a burst of messages would all pass the cap check before any was logged.
const inFlight = new Map();
if (!secrets.bot_token || !secrets.adam_user_id) { console.error("[benny] ~/.benny/discord.json needs bot_token and adam_user_id"); process.exit(2); }

const loadQa = () => (existsSync(QA) ? JSON.parse(readFileSync(QA, "utf8")) : { answers: [] });
function logQa(entry) { const qa = loadQa(); qa.answers.push(entry); writeFileSync(QA, JSON.stringify(qa, null, 2) + "\n"); }
const ping = (title, body) => ntfyPing(fetch, title, body).catch((e) => console.error(`[benny] ntfy failed: ${e.message}`));

function runClaude(question) {
  return new Promise((ok, fail) => {
    const args = buildClaudeArgs({ persona, mcpConfig: join(ROOT, "benny/mcp.json"), dataDir: join(ROOT, "db") });
    const p = spawn(CLAUDE, args, { cwd: WORK, windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { p.kill(); fail(new Error("claude took longer than 180 seconds")); }, 180000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(timer); fail(e); });
    // A non-zero exit still carries the stream (an auth or API error lands in the result), so hand it back
    // and let the result check below decide; only a run with no output at all is a failure here.
    p.on("close", (code) => { clearTimeout(timer); out ? ok(out) : fail(new Error(`claude exited ${code} with no output: ${err.slice(0, 300)}`)); });
    p.stdin.end(question);
  });
}

async function send(m, text) {
  const parts = splitForDiscord(text);
  for (const [i, content] of parts.entries()) {
    if (i === 0) await m.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
    else await m.channel.send({ content, allowedMentions: { parse: [] } });
  }
}

async function refuse(m, base, reasons) {
  logQa({ ...base, outcome: "REFUSED", reasons });
  await ping("BENNY ANSWER REFUSED", `From: ${base.asker}
Question: ${base.question}\n\n${reasons.map((r) => `- ${r}`).join("\n")}`);
  await m.reply({ content: NO_ANSWER, allowedMentions: { parse: [], repliedUser: false } });
}

async function handle(m) {
  const who = askerOf(m, secrets.adam_user_id, askers, memberCap);
  if (!who) return; // everyone else is ignored silently
  const now = new Date();
  const question = m.content.trim();
  const base = { at: now.toISOString(), date: nyDate(now), asker: who.name, ...(who.member ? { asker_id: who.id, member: true } : {}), question };
  const cmd = commandOf(question);
  if (cmd && !who.adam) { await m.reply({ content: "Only my operator can do that.", allowedMentions: { parse: [], repliedUser: false } }); return; }
  if (cmd === "halt") { writeFileSync(HALT, `halted by Adam in #ask-benny ${base.at}\n`); await m.reply("Halted. Nothing posts and I answer nothing until !resume."); return; }
  if (cmd === "resume") { if (existsSync(HALT)) unlinkSync(HALT); await m.reply("Resumed."); return; }
  if (existsSync(HALT)) { logQa({ ...base, outcome: "HALTED" }); return; }
  const cap = who.adam ? cfg.daily_answer_cap : who.cap;
  const used = who.member ? memberQuestionsToday(loadQa(), base.date, who.id) + (inFlight.get(who.id) || 0) : answersToday(loadQa(), base.date, who.name);
  if (used >= cap) { logQa({ ...base, outcome: "CAPPED" }); await send(m, composeAnswer(who.member ? memberCapMessage(cap) : "Done for today.")); return; }
  if (!who.member) return answerQuestion(m, who, base, question, now);
  inFlight.set(who.id, (inFlight.get(who.id) || 0) + 1);
  try { await answerQuestion(m, who, base, question, now); }
  finally { const n = (inFlight.get(who.id) || 1) - 1; if (n > 0) inFlight.set(who.id, n); else inFlight.delete(who.id); }
}

async function answerQuestion(m, who, base, question, now) {
  let s;
  try { s = parseStream(await runClaude(framedQuestion(question, who))); }
  catch (e) { await refuse(m, base, [`claude failed: ${e.message}`]); return; }
  if (!s.init) { await refuse(m, base, ["no init message - the tool list cannot be proven"]); return; }
  const tools = checkTools(s.tools);
  if (!tools.ok) { await refuse(m, base, [`tools outside the allowlist were visible: ${tools.bad.join(", ")}`]); return; }
  if (s.isError || !s.result) { await refuse(m, base, [`claude returned an error or no answer${s.result ? `: ${String(s.result).slice(0, 200)}` : ""}`]); return; }
  const topic = topicGate(s.result);
  if (topic.offTopic) { await send(m, composeAnswer(topic.body)); logQa({ ...base, outcome: "OFF_TOPIC" }); return; }
  if (!topic.ok) { await refuse(m, base, [`topic: ${topic.reason}`]); return; }
  const answer = composeAnswer(topic.body);
  const wall = checkWall(answer, loadWall(), now);
  if (!wall.ok) { await refuse(m, base, wall.reasons.map((r) => `wall: ${r}`)); return; }
  const leaks = secretLeaks(answer, secrets);
  if (leaks.length) { await refuse(m, base, leaks.map((r) => `secret: ${r}`)); return; }
  const inside = internalsLeaks(answer);
  if (inside.length) { await refuse(m, base, inside.map((r) => `internals: ${r}`)); return; }
  await send(m, answer);
  logQa({ ...base, outcome: "ANSWERED", answer, cost_usd: s.cost });
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
client.on(Events.MessageCreate, (m) => handle(m).catch((e) => ping("BENNY LISTENER ERROR", e.message)));
client.once(Events.ClientReady, (c) => console.log(`[benny] listening as ${c.user.tag}`));
client.login(secrets.bot_token);
