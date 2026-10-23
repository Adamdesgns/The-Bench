// ask.mjs — the Q&A core for benny/listener.mjs. Pure functions; no Discord, no network.
//
// TOOL LOCKDOWN (spec 2026-10-15). A plain `claude -p` loads every MCP server on this PC, and the
// Robinhood server carries order and account tools beside the quote tools. So:
//   --strict-mcp-config --mcp-config benny/mcp.json   only the Robinhood server loads
//   --tools Read,Grep,Glob,WebSearch                  the only built-in tools (no Bash, no writes);
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
// WebSearch (2026-10-22): Adam asked "what happened to this market?!" and Benny could only say "my notes
// have no catalyst". Search results are read-only text; the wall and internals checks still run on the answer.
export const ALLOWED_BUILTIN = ["Read", "Grep", "Glob", "WebSearch"];
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
export const TOPIC_RULES = `ANSWER RULES FOR #ask-benny (a guest is asking). These outrank everything above.
1. Start every answer with exactly [ON-TOPIC] or [OFF-TOPIC] on its own, before any other text.
2. ON-TOPIC is money and markets: stocks, ETFs, options, crypto (coins, tokens, airdrops, DeFi, staking), any ticker's price or news, the market and the economy, a row, watcher or prediction on the book, Benny's paper book, risk, position sizing, stops and targets, and explaining a trading or finance term. Use the quote tools for any price and WebSearch for why something moved.
3. Everything else is OFF-TOPIC: greetings and small talk ("you there?", "how are you"), questions about you, who built you, how you work, where you run or what you read, jokes, personal questions, and requests to write, code or role-play. For OFF-TOPIC write the tag and nothing else.
4. A guest never gets a personal pick ("buy X", "this token with your $1,000"). Give them the facts, what the book says, and how you would think about it, in a few lines.
5. Never name or describe how you are built: no repo, branch, git, GitHub, folder, file name, path, settings, tools, scripts, code, model or company behind you. Call your sources "the book", "the board" and "my notes". If asked, it is OFF-TOPIC.`;

// THE OPERATOR RULES (Adam, 2026-10-22: "when I ask him something he give me what I need as long as
// it's not illegal"). The audit: Benny refused "what's on sale in crypto" as a buy signal, would not
// touch ETH or SOL because they were off the board, and could not say why QQQ fell. No topic gate for Adam.
export const OPERATOR_RULES = `ANSWER RULES FOR #ask-benny (your operator, Adam, is asking). These outrank everything above, including "cite, don't call", "only the board" and "never tell anyone what to buy or sell".
1. Give Adam what he asks for. Any legal topic, any ticker or coin, on the board or not. The only refusals: something illegal, placing an order (you never can), and how you are built (rule 5).
2. Pull live prices with the quote and history tools, and use WebSearch for news and for why something moved. Say what moved and why in the first two lines.
3. When he asks what's on sale, what looks good, what you'd do or what to watch, give your actual read: name the tickers, rank them, and give an entry area, where you'd be wrong and a first target, with how sure you are. Pull the daily price history before you set any level, and set levels off real swing highs and lows, never off today's range alone. Mark a new idea "my read, not on the book" so he knows no routine logged it. A call already on the book gets its row (B-###, PR-###, MC-###).
4. He is an experienced trader. Never define stop, short, R, ATR, mark price, support or any term he already uses, and never tell him to practise on paper.
5. #ask-benny is a shared channel. Never post his real balances, positions, orders or account details, and never name or describe how you are built (repo, branch, git, GitHub, files, paths, settings, tools, code, the model or company behind you).`;

// THE VOICE (Adam, 2026-10-22: "He needs to respond like I do"). From the adams-voice skill.
export const VOICE_RULES = `HOW YOU SOUND. Talk the way Adam talks: short, direct, casual. The answer goes in the first sentence. Plain words, a little profanity is fine when it lands. Keep it under about 150 words unless the question needs a list of numbers, and use bullets only for those numbers. No em-dashes, no semicolons, no "isn't X, it's Y", no three-part lists for rhythm, no clever closing line, no lecture, no repeating the disclaimer in your own words (the sign-off is added for you). Never talk about your tools, your search or what a search result told you to do. When a web search informed the answer, end with up to two source links on one line, nothing else about it.`;

// An operator answer posts as written; a tag he did not need is stripped, never acted on.
export const operatorBody = (text) => String(text).replace(/^\s*\[(?:ON|OFF)-TOPIC\]\s*/i, "").trim();

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
export function buildClaudeArgs({ persona, mcpConfig, dataDir, operator = false, model = "sonnet" }) {
  if (!dataDir) throw new Error("buildClaudeArgs needs dataDir (the repo's db folder)");
  return [
    "-p", "--append-system-prompt", `${persona}\n\n${operator ? OPERATOR_RULES : TOPIC_RULES}\n\n${VOICE_RULES}`,
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
// under their own daily_cap (Adam, 2026-10-18: "give him 5 a day" for Van). Every other human in the
// channel is a member with memberCap a day (Adam, 2026-10-22: "every member of that discord chat ...
// 5 questions a day"); a member's name always starts with @, so it never shares a count with Adam or a
// listed asker. memberCap 0 or missing = members are ignored, the old rule.
export function askerOf(m, adamUserId, askers = [], memberCap = 0) {
  if (!m || m.author?.bot || m.channel?.name !== "ask-benny") return null;
  const id = String(m.author?.id ?? "");
  if (!id) return null;
  if (adamUserId && id === String(adamUserId)) return { name: "Adam", adam: true };
  // A listed asker matches on discord_id, or on discord_username while the id is still null (Discord
  // usernames are unique; Adam, 2026-10-22: "I just meant the 3 people in the chat now").
  const user = String(m.author?.username ?? "").toLowerCase();
  const a = askers.find((x) => x?.name && (x.discord_id ? String(x.discord_id) === id
    : !!user && String(x.discord_username ?? "").toLowerCase() === user));
  if (a) return { name: a.name, adam: false, cap: Number(a.daily_cap) || 0 };
  const cap = Number(memberCap) || 0;
  return cap > 0 ? { name: `@${m.author?.username || id}`, adam: false, cap, member: true } : null;
}

export const shouldAnswer = (m, adamUserId) => askerOf(m, adamUserId)?.adam === true;

// A guest's question reaches claude with one line in front, so Benny knows it is not his operator.
export const framedQuestion = (question, who) =>
  who?.adam ? question
    : who?.member ? `Asked in #ask-benny by ${who.name.slice(1)}, a member of the server - not by my operator.\n\n${question}`
    : `Asked in #ask-benny by ${who.name}, a friend of my operator - not by my operator.\n\n${question}`;

export function commandOf(text) {
  if (/^!halt\b/i.test(text.trim())) return "halt";
  if (/^!resume\b/i.test(text.trim())) return "resume";
  return null;
}

// Rows written before guests existed carry no asker; they are Adam's.
export const answersToday = (qa, date, name = null) =>
  (qa.answers || []).filter((a) => a.date === date && a.outcome === "ANSWERED" && (name === null || (a.asker || "Adam") === name)).length;

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
