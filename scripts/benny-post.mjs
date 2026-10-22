// benny-post.mjs — THE ONLY DOOR TO DISCORD.
//
//   node scripts/benny-post.mjs --channel morning --file docs/benny/2026-10-16-premarket.md [--dry-run]
//
// Reads the post as UTF-8, refuses it (and pings Adam's phone with the reason) when: the wall check
// fails, the fixed sign-off is missing, a placeholder is left in, the same file or the same text was
// already posted, or benny/HALT exists. Otherwise splits it into parts of at most 2,000 characters
// and sends them: to the channel's Discord webhook in live mode, to Adam's phone titled
// "BENNY DRY RUN" in dry mode (db/benny-config.json). Every send and refusal is appended to
// db/benny-posts.json. --dry-run prints what would happen and touches nothing.
// Webhooks live in ~/.benny/discord.json, never in the repo.
// Spec: docs/superpowers/specs/2026-10-15-benny-discord-bot-design.md. Zero-dep. Tests: test/benny-post.test.mjs.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { splitBody, TOPIC } from "./ntfy-read.mjs";
import { checkWall, loadWall, bennyHome, internalsLeaks } from "./benny-wall.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CHANNELS = ["morning", "paper-trades", "close", "lesson", "scorecard", "ask-benny"];
export const SIGN_OFF = "Paper trades only. Not financial advice. Educational only.";
const DISCORD_MAX = 2000;
const PLACEHOLDERS = [/\bTBD\b/, /\bTODO\b/, /\{\{/, /\bXX\.XX\b/i];
const chars = (s) => [...s].length;

export function splitForDiscord(text) {
  const parts = splitBody(text, DISCORD_MAX - 12, chars);
  return parts.length === 1 ? parts : parts.map((p, i) => `(${i + 1}/${parts.length}) ${p}`);
}

export async function ntfyPing(fetchImpl, title, body) {
  const res = await fetchImpl(TOPIC, {
    method: "POST",
    headers: { Title: title.replace(/[^\x20-\x7E]/g, "").trim() || "BENNY", Priority: "urgent", Markdown: "yes" },
    body,
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
const saveJson = (p, d) => writeFileSync(p, JSON.stringify(d, null, 2) + "\n");

export async function postBenny({ channel, file, root = ROOT, home = bennyHome(), fetchImpl = fetch, now = new Date(), dryRun = false }) {
  const logPath = join(root, "db/benny-posts.json");
  const log = readJson(logPath, { posts: [] });
  const cfg = readJson(join(root, "db/benny-config.json"), {});
  const rel = relative(root, resolve(root, file)).replace(/\\/g, "/");
  const text = readFileSync(resolve(root, file), "utf8").replace(/\r\n/g, "\n").trim();
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);

  const reasons = [];
  if (!CHANNELS.includes(channel)) reasons.push(`unknown channel "${channel}" (one of ${CHANNELS.join(", ")})`);
  if (!["dry", "live"].includes(cfg.mode)) reasons.push(`db/benny-config.json mode must be "dry" or "live"`);
  if (existsSync(join(root, "benny/HALT"))) reasons.push("benny/HALT is in place - all posting is stopped");
  if (!text) reasons.push("the post is empty");
  if (!text.includes(SIGN_OFF)) reasons.push(`the sign-off is missing: "${SIGN_OFF}"`);
  for (const p of PLACEHOLDERS) if (p.test(text)) reasons.push(`a placeholder is left in the text (${p.source})`);
  const done = log.posts.filter((p) => p.outcome === "SENT" || p.outcome === "DRY");
  if (done.some((p) => p.file === rel)) reasons.push(`${rel} was already posted`);
  else if (done.some((p) => p.hash === hash)) reasons.push("the same text was already posted under another file");
  reasons.push(...checkWall(text, loadWall(home), now).reasons.map((r) => `wall: ${r}`));
  reasons.push(...internalsLeaks(text).map((r) => `internals: ${r}`));
  let hook = null;
  if (cfg.mode === "live" && CHANNELS.includes(channel)) {
    const secrets = readJson(join(home, "discord.json"), null);
    hook = secrets?.webhooks?.[channel] || null;
    if (!hook) reasons.push(`no webhook for #${channel} in ~/.benny/discord.json`);
  }

  const parts = reasons.length ? [] : splitForDiscord(text);
  if (dryRun) return { outcome: reasons.length ? "WOULD-REFUSE" : "WOULD-SEND", reasons, parts };
  const entry = { at: now.toISOString(), channel, file: rel, hash, parts: parts.length, mode: cfg.mode };

  if (reasons.length) {
    saveJson(logPath, { posts: [...log.posts, { ...entry, outcome: "REFUSED", reasons }] });
    await ntfyPing(fetchImpl, `BENNY REFUSED - ${channel}`, `${rel}\n\n${reasons.map((r) => `- ${r}`).join("\n")}`);
    return { outcome: "REFUSED", reasons, parts };
  }
  let sent = 0;
  try {
    for (const [i, p] of parts.entries()) {
      if (cfg.mode === "live") {
        const res = await fetchImpl(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: p, allowed_mentions: { parse: [] } }) });
        if (!res.ok) throw new Error(`Discord HTTP ${res.status}`);
      } else {
        await ntfyPing(fetchImpl, `BENNY DRY RUN - ${channel}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ""}`, p);
      }
      sent++;
    }
  } catch (e) {
    saveJson(logPath, { posts: [...log.posts, { ...entry, outcome: "FAILED", sent, error: e.message }] });
    await ntfyPing(fetchImpl, `BENNY POST FAILED - ${channel}`, `${rel}: ${sent} of ${parts.length} part(s) went out. ${e.message}`).catch(() => {});
    return { outcome: "FAILED", reasons: [e.message], parts };
  }
  const outcome = cfg.mode === "live" ? "SENT" : "DRY";
  saveJson(logPath, { posts: [...log.posts, { ...entry, outcome }] });
  return { outcome, reasons: [], parts };
}

async function main() {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  if (!val("--channel") || !val("--file")) { console.log("usage: benny-post.mjs --channel <name> --file <path> [--dry-run]"); process.exit(1); }
  const r = await postBenny({ channel: val("--channel"), file: val("--file"), dryRun: argv.includes("--dry-run") });
  console.log(`BENNY POST ${r.outcome} #${val("--channel")} ${val("--file")} (${r.parts.length} part(s))`);
  r.reasons.forEach((x) => console.log(`  - ${x}`));
  if (r.outcome === "REFUSED" || r.outcome === "FAILED" || r.outcome === "WOULD-REFUSE") process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`[benny-post] ${e.message}`); process.exit(1); });
