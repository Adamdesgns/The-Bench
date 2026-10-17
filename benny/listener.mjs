// listener.mjs — ASK BENNY: answers Adam's questions in #ask-benny. Nobody else's. Never trades.
//
// For each question from Adam it runs a locked-down `claude -p` (see benny/ask.mjs), checks the
// session's own tool list, appends the fixed sign-off, runs the wall check, and only then posts.
// Any failure posts a short non-answer and pings Adam's phone with the reason.
// !halt writes benny/HALT (stops every post and answer); !resume removes it. At most
// daily_answer_cap answers a day (db/benny-config.json). Every question is logged to db/benny-qa.json.
// Settings: ~/.benny/discord.json (bot_token, adam_user_id) - never committed, never printed.
// Started by benny/run-listener.ps1. Spec: docs/superpowers/specs/2026-10-15-benny-discord-bot-design.md

import { Client, Events, GatewayIntentBits } from "discord.js";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildClaudeArgs, checkTools, parseStream, shouldAnswer, commandOf, answersToday, composeAnswer } from "./ask.mjs";
import { checkWall, loadWall, bennyHome } from "../scripts/benny-wall.mjs";
import { splitForDiscord, ntfyPing } from "../scripts/benny-post.mjs";
import { nyDate } from "../scripts/paper-book.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HALT = join(ROOT, "benny/HALT");
const QA = join(ROOT, "db/benny-qa.json");
const CLAUDE = process.env.BENNY_CLAUDE || join(homedir(), ".local/bin/claude.exe");
const NO_ANSWER = "Not answering this one. My operator has been told why.";

const secrets = JSON.parse(readFileSync(join(bennyHome(), "discord.json"), "utf8"));
const cfg = JSON.parse(readFileSync(join(ROOT, "db/benny-config.json"), "utf8"));
const persona = readFileSync(join(ROOT, cfg.persona), "utf8");
if (!secrets.bot_token || !secrets.adam_user_id) { console.error("[benny] ~/.benny/discord.json needs bot_token and adam_user_id"); process.exit(2); }

const loadQa = () => (existsSync(QA) ? JSON.parse(readFileSync(QA, "utf8")) : { answers: [] });
function logQa(entry) { const qa = loadQa(); qa.answers.push(entry); writeFileSync(QA, JSON.stringify(qa, null, 2) + "\n"); }
const ping = (title, body) => ntfyPing(fetch, title, body).catch((e) => console.error(`[benny] ntfy failed: ${e.message}`));

function runClaude(question) {
  return new Promise((ok, fail) => {
    const p = spawn(CLAUDE, buildClaudeArgs({ persona, mcpConfig: join(ROOT, "benny/mcp.json") }), { cwd: ROOT, windowsHide: true });
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
  await ping("BENNY ANSWER REFUSED", `Question: ${base.question}\n\n${reasons.map((r) => `- ${r}`).join("\n")}`);
  await m.reply({ content: NO_ANSWER, allowedMentions: { parse: [], repliedUser: false } });
}

async function handle(m) {
  if (!shouldAnswer(m, secrets.adam_user_id)) return; // everyone else is ignored silently
  const now = new Date();
  const question = m.content.trim();
  const base = { at: now.toISOString(), date: nyDate(now), question };
  const cmd = commandOf(question);
  if (cmd === "halt") { writeFileSync(HALT, `halted by Adam in #ask-benny ${base.at}\n`); await m.reply("Halted. Nothing posts and I answer nothing until !resume."); return; }
  if (cmd === "resume") { if (existsSync(HALT)) unlinkSync(HALT); await m.reply("Resumed."); return; }
  if (existsSync(HALT)) { logQa({ ...base, outcome: "HALTED" }); return; }
  if (answersToday(loadQa(), base.date) >= cfg.daily_answer_cap) { logQa({ ...base, outcome: "CAPPED" }); await send(m, composeAnswer("Done for today.")); return; }

  let s;
  try { s = parseStream(await runClaude(question)); }
  catch (e) { await refuse(m, base, [`claude failed: ${e.message}`]); return; }
  if (!s.init) { await refuse(m, base, ["no init message - the tool list cannot be proven"]); return; }
  const tools = checkTools(s.tools);
  if (!tools.ok) { await refuse(m, base, [`tools outside the allowlist were visible: ${tools.bad.join(", ")}`]); return; }
  if (s.isError || !s.result) { await refuse(m, base, [`claude returned an error or no answer${s.result ? `: ${String(s.result).slice(0, 200)}` : ""}`]); return; }
  const answer = composeAnswer(s.result);
  const wall = checkWall(answer, loadWall(), now);
  if (!wall.ok) { await refuse(m, base, wall.reasons.map((r) => `wall: ${r}`)); return; }
  await send(m, answer);
  logQa({ ...base, outcome: "ANSWERED", answer, cost_usd: s.cost });
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
client.on(Events.MessageCreate, (m) => handle(m).catch((e) => ping("BENNY LISTENER ERROR", e.message)));
client.once(Events.ClientReady, (c) => console.log(`[benny] listening as ${c.user.tag}`));
client.login(secrets.bot_token);
