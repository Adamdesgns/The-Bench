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

// The question is written to stdin by the caller, so nothing it contains can be read as a flag.
export function buildClaudeArgs({ persona, mcpConfig, model = "sonnet" }) {
  return [
    "-p", "--append-system-prompt", persona,
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

export const shouldAnswer = (m, adamUserId) =>
  !!adamUserId && m?.author?.id === String(adamUserId) && !m.author.bot && m.channel?.name === "ask-benny";

export function commandOf(text) {
  if (/^!halt\b/i.test(text.trim())) return "halt";
  if (/^!resume\b/i.test(text.trim())) return "resume";
  return null;
}

export const answersToday = (qa, date) => (qa.answers || []).filter((a) => a.date === date && a.outcome === "ANSWERED").length;

export function composeAnswer(text) {
  const body = String(text).replace(/\r\n/g, "\n").split(SIGN_OFF).join("").trim();
  return `${body}\n\n${SIGN_OFF}`;
}
