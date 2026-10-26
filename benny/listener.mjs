// listener.mjs — ASK BENNY: answers questions in #ask-benny from Adam and the askers listed in
// db/benny-config.json (each under their own daily_cap). Nobody else's. Never trades.
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
import { buildClaudeArgs, checkTools, parseStream, askerOf, framedQuestion, commandOf, answersToday, composeAnswer, secretLeaks, topicGate, operatorBody,
  recentExchanges, knownTickers, tickersIn, bookFacts, withContext, MENU,
  parseRunRequest, describeRequest, nextRequestId, requestsToday, duplicateOf, requestCommandOf, runArgs, relayQuestion, REQUEST_CAP } from "./ask.mjs";
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
if (!secrets.bot_token || !secrets.adam_user_id) { console.error("[benny] ~/.benny/discord.json needs bot_token and adam_user_id"); process.exit(2); }

const REQS = join(ROOT, "db/benny-requests.json");
const loadRequests = () => (existsSync(REQS) ? JSON.parse(readFileSync(REQS, "utf8")) : { requests: [] });
const saveRequests = (store) => writeFileSync(REQS, JSON.stringify(store, null, 2) + "\n");
const loadQa = () => (existsSync(QA) ? JSON.parse(readFileSync(QA, "utf8")) : { answers: [] });
function logQa(entry) { const qa = loadQa(); qa.answers.push(entry); writeFileSync(QA, JSON.stringify(qa, null, 2) + "\n"); }
// Read fresh on every question, so a row logged a minute ago is already in the lookup. A file that is
// missing or mid-write gives an empty list for that source, never a crash.
const readList = (file, pick) => { try { return pick(JSON.parse(readFileSync(join(ROOT, "db", file), "utf8"))) || []; } catch { return []; } };
const loadBookData = () => ({
  book: readList("archive.json", (x) => x),
  predictions: readList("predictions.json", (x) => x.predictions),
  watchers: readList("mind-changers.json", (x) => x.items),
  benny: readList("benny-book.json", (x) => x.trades),
});
function questionWithNotes(question, who, now) {
  const data = loadBookData();
  const asked = tickersIn(question, knownTickers(data));
  return withContext(framedQuestion(question, who), { history: recentExchanges(loadQa(), who.name, now), facts: bookFacts(asked, data), asked });
}
const ping = (title, body) => ntfyPing(fetch, title, body).catch((e) => console.error(`[benny] ntfy failed: ${e.message}`));

function runClaude(question, operator) {
  return new Promise((ok, fail) => {
    const args = buildClaudeArgs({ persona, mcpConfig: join(ROOT, "benny/mcp.json"), dataDir: join(ROOT, "db"), operator });
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

// One answer, every check, for a fresh question and for a relayed one. A relay never files a new request
// and logs as RELAYED, which no daily cap counts.
async function answer(m, base, who, prompt, { relay = null } = {}) {
  const now = new Date(base.at);
  let s;
  try { s = parseStream(await runClaude(prompt, who.adam)); }
  catch (e) { await refuse(m, base, [`claude failed: ${e.message}`]); return; }
  if (!s.init) { await refuse(m, base, ["no init message - the tool list cannot be proven"]); return; }
  const tools = checkTools(s.tools);
  if (!tools.ok) { await refuse(m, base, [`tools outside the allowlist were visible: ${tools.bad.join(", ")}`]); return; }
  if (s.isError || !s.result) { await refuse(m, base, [`claude returned an error or no answer${s.result ? `: ${String(s.result).slice(0, 200)}` : ""}`]); return; }
  // Adam has no topic gate (operator rules); a guest answer must carry its tag.
  const topic = who.adam ? { ok: true, body: operatorBody(s.result) } : topicGate(s.result);
  if (topic.offTopic) { await send(m, composeAnswer(topic.body)); logQa({ ...base, outcome: "OFF_TOPIC" }); return; }
  if (!topic.ok) { await refuse(m, base, [`topic: ${topic.reason}`]); return; }
  const { body, request } = parseRunRequest(topic.body);
  const filed = relay ? null : fileRequest(m, base, who, request);
  const text = composeAnswer(filed ? `${body}\n\n${filed}` : body);
  const wall = checkWall(text, loadWall(), now);
  if (!wall.ok) { await refuse(m, base, wall.reasons.map((r) => `wall: ${r}`)); return; }
  const leaks = secretLeaks(text, secrets);
  if (leaks.length) { await refuse(m, base, leaks.map((r) => `secret: ${r}`)); return; }
  const inside = internalsLeaks(text);
  if (inside.length) { await refuse(m, base, inside.map((r) => `internals: ${r}`)); return; }
  await send(m, text);
  logQa({ ...base, outcome: relay ? "RELAYED" : "ANSWERED", answer: text, cost_usd: s.cost, ...(relay ? { request_id: relay } : {}) });
}

// RUN REQUESTS (db/benny-requests.json). Returns the line the asker sees, or null when there was no tag.
// A bad tag is dropped with a note to Adam, never filed.
function fileRequest(m, base, who, request) {
  if (!request) return null;
  if (request.error) { ping("BENNY RUN REQUEST DROPPED", `From: ${base.asker}\nQuestion: ${base.question}\nReason: ${request.error}`); return null; }
  const store = loadRequests();
  const dup = duplicateOf(store.requests, request);
  if (dup) return `That run is already requested (${dup.id}). I'll post it here when it's done.`;
  if (!who.adam && requestsToday(store.requests, who.name, base.date) >= REQUEST_CAP) return `You've hit ${REQUEST_CAP} run requests for today, so this one wasn't filed.`;
  const id = nextRequestId(store.requests);
  store.requests.push({ id, at: base.at, date: base.date, asker: who.name, adam: !!who.adam, member: !!who.member,
    question: base.question, channel_id: m.channel.id, message_id: m.id, request, status: "OPEN" });
  saveRequests(store);
  ping(`BENNY RUN REQUEST ${id}`, `${base.asker} wants: ${describeRequest(request)}\nQuestion: ${base.question}\n\nType !run ${id} in #ask-benny to run it, or !deny ${id}.`);
  return `Requested: ${describeRequest(request)} (${id}). My operator runs it, then I'll post the result here.`;
}

function runScript(args) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true });
    let out = "";
    const timer = setTimeout(() => p.kill(), 180000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (e) => { clearTimeout(timer); ok({ code: -1, out: `${out}\n${e.message}` }); });
    p.on("close", (code) => { clearTimeout(timer); ok({ code, out }); });
  });
}

// !run / !deny, Adam only. The run happens here, outside Benny's session, with runArgs' fixed list.
async function handleRequest(m, rc) {
  const store = loadRequests();
  const r = store.requests.find((x) => x.id === rc.id);
  const say = (content) => m.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
  if (!r) { await say(`No request ${rc.id}.`); return; }
  if (r.status !== "OPEN") { await say(`${r.id} is already ${r.status}.`); return; }
  const original = await m.channel.messages.fetch(r.message_id).catch(() => null);
  const target = original || m;
  if (rc.action === "deny") {
    r.status = "DENIED"; r.closed = new Date().toISOString(); saveRequests(store);
    await target.reply({ content: composeAnswer(`My operator passed on ${r.id} (${describeRequest(r.request)}).`), allowedMentions: { parse: [], repliedUser: false } });
    return;
  }
  r.status = "RUNNING"; saveRequests(store);
  await say(`Running ${r.id}: ${describeRequest(r.request)}.`);
  const res = await runScript(runArgs(r.request, r.id));
  const done = loadRequests(), row = done.requests.find((x) => x.id === r.id);
  Object.assign(row, { status: res.code === 0 ? "RAN" : "FAILED", closed: new Date().toISOString(), exit: res.code, output_tail: res.out.slice(-1500) });
  saveRequests(done);
  if (res.code !== 0) { await say(`${r.id} failed (exit ${res.code}). Nothing was relayed.\n${res.out.slice(-400)}`); return; }
  const who = { name: r.asker, adam: r.adam, member: r.member };
  const base = { at: new Date().toISOString(), date: nyDate(new Date()), asker: r.asker, question: r.question };
  await answer(target, base, who, framedQuestion(relayQuestion(r.question, r.id, r.request, res.out), who), { relay: r.id });
}

async function handle(m) {
  const who = askerOf(m, secrets.adam_user_id, askers, memberCap);
  if (!who) return; // everyone else is ignored silently
  const now = new Date();
  const question = m.content.trim();
  const base = { at: now.toISOString(), date: nyDate(now), asker: who.name, question };
  const cmd = commandOf(question);
  // The menu is for anyone who can ask, even while halted or capped, and costs nothing (fixed text).
  if (cmd === "menu") { await send(m, composeAnswer(MENU)); logQa({ ...base, outcome: "MENU" }); return; }
  const rc = requestCommandOf(question);
  if ((cmd || rc) && !who.adam) { await m.reply({ content: "Only my operator can do that.", allowedMentions: { parse: [], repliedUser: false } }); return; }
  if (cmd === "halt") { writeFileSync(HALT, `halted by Adam in #ask-benny ${base.at}\n`); await m.reply("Halted. Nothing posts and I answer nothing until !resume."); return; }
  if (cmd === "resume") { if (existsSync(HALT)) unlinkSync(HALT); await m.reply("Resumed."); return; }
  if (existsSync(HALT)) { logQa({ ...base, outcome: "HALTED" }); return; }
  if (rc) { await handleRequest(m, rc); return; }
  const cap = who.adam ? cfg.daily_answer_cap : who.cap;
  if (answersToday(loadQa(), base.date, who.name) >= cap) { logQa({ ...base, outcome: "CAPPED" }); await send(m, composeAnswer("Done for today.")); return; }
  await answer(m, base, who, questionWithNotes(question, who, now));
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
client.on(Events.MessageCreate, (m) => handle(m).catch((e) => ping("BENNY LISTENER ERROR", e.message)));
client.once(Events.ClientReady, (c) => console.log(`[benny] listening as ${c.user.tag}`));
client.login(secrets.bot_token);
