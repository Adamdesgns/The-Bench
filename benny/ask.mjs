// ask.mjs — the Q&A core for benny/listener.mjs. Pure functions; no Discord, no network.
//
// TOOL LOCKDOWN (spec 2026-10-15). A plain `claude -p` loads every MCP server on this PC, and the
// Robinhood server carries order and account tools beside the quote tools. So:
//   --strict-mcp-config --mcp-config benny/mcp.json   only the Robinhood server loads
//   --tools Read,Grep,Glob                            the only built-in tools (no Bash, no writes);
//                                                     this also ignores user/project settings files
//   --allowedTools <each allowed tool by full name>   never the whole server, never a wildcard
//   --disallowedTools <every other Robinhood tool>    a slip in the allow list still cannot reach them
//   --permission-mode dontAsk                         anything not allowed is refused, not asked
// The listener reads the session's own init message on EVERY answer and refuses to post if any tool
// outside ALLOWED_TOOLS is visible. A Robinhood tool added later that is not named in RH_TOOLS below
// shows up there and stops the answer; add it to RH_TOOLS (it is denied by default), never to the allow list.
// RH_TOOLS includes the order tools Adam's own settings already deny (place_equity_order and friends),
// because --tools makes this session ignore those settings files.

import { SIGN_OFF } from "../scripts/benny-post.mjs";

const RH = "mcp__robinhood-trading__";
export const ALLOWED_BUILTIN = ["Read", "Grep", "Glob"];
export const ALLOWED_MCP = ["get_equity_quotes", "get_crypto_quotes", "get_equity_historicals", "get_earnings_calendar"].map((n) => RH + n);
export const ALLOWED_TOOLS = [...ALLOWED_BUILTIN, ...ALLOWED_MCP];

const RH_TOOLS = [
  "add_legend_indicator", "add_option_to_watchlist", "add_to_watchlist", "cancel_advanced_order", "cancel_crypto_order",
  "cancel_equity_order", "cancel_option_exercise", "cancel_option_order", "create_alert", "create_scan", "create_watchlist",
  "decline_trade_approval", "delete_alert", "exercise_option", "follow_watchlist", "get_accounts", "get_advanced_orders",
  "get_alert_log", "get_alerts", "get_crypto_account_onboarding_info", "get_crypto_orders", "get_crypto_positions",
  "get_crypto_quotes", "get_currency_pairs", "get_earnings_calendar", "get_earnings_results", "get_equity_analyst_ratings",
  "get_equity_fundamentals", "get_equity_historicals", "get_equity_orders", "get_equity_positions", "get_equity_price_book",
  "get_equity_quotes", "get_equity_tax_lots", "get_equity_technical_indicators", "get_equity_tradability", "get_financials",
  "get_index_historicals", "get_index_quotes", "get_indexes", "get_legend_charts", "get_legend_indicator_catalog",
  "get_legend_indicators", "get_legend_layouts", "get_limited_margin_upgrade_info", "get_option_chains", "get_option_historicals",
  "get_option_instruments", "get_option_level_upgrade_info", "get_option_orders", "get_option_positions", "get_option_quotes",
  "get_option_watchlist", "get_pnl_trade_history", "get_politician_trades", "get_popular_watchlists", "get_portfolio",
  "get_realized_pnl", "get_scanner_datapoints", "get_scanner_filter_specs", "get_scans", "get_sec_filing", "get_sec_filing_facts",
  "get_sec_filing_facts_catalog", "get_sec_filing_index", "get_trade_approval_setting", "get_trade_approvals",
  "get_watchlist_items", "get_watchlists", "mark_alerts_read", "place_advanced_order", "place_crypto_order", "place_equity_order",
  "place_option_order", "preview_crypto_order", "preview_scan", "remove_from_watchlist", "remove_legend_indicator",
  "remove_option_from_watchlist", "review_advanced_order", "review_equity_order", "review_option_order", "run_scan", "search",
  "set_legend_chart_settings", "unfollow_watchlist", "update_alert", "update_legend_indicator", "update_scan_config",
  "update_scan_filters", "update_watchlist",
];
export const DENIED_TOOLS = RH_TOOLS.map((n) => RH + n).filter((t) => !ALLOWED_MCP.includes(t));
export const FORBIDDEN = /place_|cancel_|exercise_|get_accounts|get_portfolio|get_equity_positions|get_equity_orders|get_option_positions/;

export function checkTools(tools) {
  const bad = tools.filter((t) => !ALLOWED_TOOLS.includes(t) || FORBIDDEN.test(t));
  return { ok: bad.length === 0, bad };
}

// THE TOPIC LIST (Adam, 2026-10-21: "it needs to be a strict conversation list. we're not shooting the
// shit. finances."). Appended after the persona for every asker, Adam included. The tag is checked by
// topicGate in code, so an off-topic question gets the fixed OFF_TOPIC line, never Benny's own words.
export const OFF_TOPIC = "I only talk markets and money. Ask me about a ticker, a setup, a trade on the book, or a trading term.";
export const TOPIC_RULES = `ANSWER RULES FOR #ask-benny. These outrank everything above.
1. Start every answer with exactly [ON-TOPIC] or [OFF-TOPIC] on its own, before any other text.
2. ON-TOPIC is only: stocks, ETFs, options, crypto prices, the market and the economy as they move prices, a ticker on the board, a row, watcher or prediction on the book, Benny's paper book, risk, position sizing, stops and targets, and explaining a trading or finance term.
3. Everything else is OFF-TOPIC: greetings and small talk ("you there?", "how are you"), questions about you, who built you, how you work, where you run or what you read, jokes, news with no price angle, personal questions, and requests to write, code or role-play. For OFF-TOPIC write the tag and nothing else.
4. Never name or describe how you are built: no repo, branch, git, GitHub, folder, file name, path, settings, tools, scripts, code, model or company behind you. Call your sources "the book", "the board" and "my notes". If asked, it is OFF-TOPIC.`;

// The first token must be the tag. A missing tag is refused (and Adam is pinged), never guessed.
export function topicGate(text) {
  const m = String(text).match(/^\s*\[(ON|OFF)-TOPIC\]\s*/i);
  if (!m) return { ok: false, offTopic: false, reason: "the answer did not start with an [ON-TOPIC] or [OFF-TOPIC] tag" };
  if (m[1].toUpperCase() === "OFF") return { ok: false, offTopic: true, body: OFF_TOPIC };
  return { ok: true, body: String(text).slice(m[0].length).trim() };
}

// The question is written to stdin by the caller, so nothing it contains can be read as a flag.
// ISOLATION (2026-10-21): the caller runs this from ~/.benny/work, outside the repo, and
// --setting-sources "" loads no settings files, so the session sees no CLAUDE.md, no memory and no
// git status. --add-dir dataDir (the repo's db/) is the only part of the repo it can read.
export function buildClaudeArgs({ persona, mcpConfig, dataDir, model = "sonnet" }) {
  if (!dataDir) throw new Error("buildClaudeArgs needs dataDir (the repo's db folder)");
  return [
    "-p", "--append-system-prompt", `${persona}\n\n${TOPIC_RULES}`,
    "--setting-sources", "",
    "--add-dir", dataDir,
    "--strict-mcp-config", "--mcp-config", mcpConfig,
    "--tools", ALLOWED_BUILTIN.join(","),
    "--allowedTools", ALLOWED_TOOLS.join(","),
    "--disallowedTools", DENIED_TOOLS.join(","),
    "--permission-mode", "dontAsk",
    "--output-format", "stream-json", "--verbose",
    "--model", model,
  ];
}

export function parseStream(stdout) {
  const msgs = String(stdout).split(/\r?\n/).filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const init = msgs.find((x) => x.type === "system" && x.subtype === "init") || null;
  const res = msgs.find((x) => x.type === "result") || null;
  return { init, tools: init?.tools || [], mcp: init?.mcp_servers || [], result: res?.result ?? null, isError: !!res?.is_error, cost: res?.total_cost_usd ?? null };
}

// Who is asking. Adam always; anyone in db/benny-config.json `askers` with a discord_id gets answers
// under their own daily_cap (Adam, 2026-10-18: "give him 5 a day" for Van). Every other member of the
// server gets memberCap a day (Adam, 2026-10-22: "give members of the bench 3 free questions a day
// anyone that joins"), counted by Discord id. memberCap 0 (or unset) means everyone else is ignored.
export function askerOf(m, adamUserId, askers = [], memberCap = 0) {
  if (!m || m.author?.bot || m.channel?.name !== "ask-benny") return null;
  const id = String(m.author?.id ?? "");
  if (!id) return null;
  if (adamUserId && id === String(adamUserId)) return { name: "Adam", adam: true };
  const a = askers.find((x) => x?.name && x?.discord_id && String(x.discord_id) === id);
  if (a) return { name: a.name, adam: false, cap: Number(a.daily_cap) || 0 };
  const cap = Number(memberCap) || 0;
  return cap > 0 ? { name: String(m.author?.username || "member"), id, adam: false, member: true, cap } : null;
}

export const shouldAnswer = (m, adamUserId) => askerOf(m, adamUserId)?.adam === true;

// A guest's question reaches claude with one line in front, so Benny knows it is not his operator.
export const framedQuestion = (question, who) =>
  who?.adam ? question : `Asked in #ask-benny by ${who.name}, ${who.member ? "a member of The Bench" : "a friend of my operator"} - not by my operator.\n\n${question}`;

export function commandOf(text) {
  if (/^!halt\b/i.test(text.trim())) return "halt";
  if (/^!resume\b/i.test(text.trim())) return "resume";
  return null;
}

// Rows written before guests existed carry no asker; they are Adam's. Member rows are left out of a
// named count, so a member whose username is "Adam" or "Van" never spends someone else's cap.
export const answersToday = (qa, date, name = null) =>
  (qa.answers || []).filter((a) => a.date === date && a.outcome === "ANSWERED" && (name === null || (!a.member && (a.asker || "Adam") === name))).length;

// A member's free questions are counted by Discord id, and every question that ran a session counts,
// answered or not: an off-topic or refused question still costs a run (and a refusal pings Adam), so a
// stranger cannot get unlimited runs by asking things Benny will not answer.
export const MEMBER_SPENT = ["ANSWERED", "OFF_TOPIC", "REFUSED"];
export const memberQuestionsToday = (qa, date, id) =>
  (qa.answers || []).filter((a) => a.date === date && a.member && String(a.asker_id) === String(id) && MEMBER_SPENT.includes(a.outcome)).length;

// The day is the New York trading day (nyDate), the same date every Benny row carries, so the free
// questions come back at midnight Eastern, which is 11 PM Central all year.
export const memberCapMessage = (cap) =>
  `That's your ${cap} free question${cap === 1 ? "" : "s"} for today. You get ${cap} more at midnight Eastern (11 PM Central).`;

// The session can Read outside the repo, so an answer is also checked for Benny's own secrets
// (~/.benny/discord.json: bot token, webhook URLs). Reasons name the setting, never the value.
const SECRET_SHAPES = [
  [/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i, "a Discord webhook URL"],
  [/[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,40}/, "a Discord bot token"],
];
const stringsIn = (v, key = "") =>
  typeof v === "string" ? [[key, v]] : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => stringsIn(x, key ? `${key}.${k}` : k)) : [];
export function secretLeaks(text, secrets = {}) {
  const t = String(text);
  const out = SECRET_SHAPES.filter(([re]) => re.test(t)).map(([, why]) => why);
  for (const [k, v] of stringsIn(secrets)) if (v.length >= 16 && t.includes(v)) out.push(`the ${k} setting`);
  return [...new Set(out)];
}

export function composeAnswer(text) {
  const body = String(text).replace(/\r\n/g, "\n").split(SIGN_OFF).join("").trim();
  return `${body}\n\n${SIGN_OFF}`;
}
