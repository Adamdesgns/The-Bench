# HERMES AGENTS — RESEARCH + INTEGRATION PLAN

*Researched Jul 2026. Confirm this is the Hermes you mean before we build — the
name is used by a few projects; this is the dominant match and fits "agents that
act via MCP."*

## What Hermes Agent is

**Hermes Agent** is Nous Research's open-source, **self-hosted autonomous agent**
(runs on your own box — a $5 VPS, a GPU workstation, or serverless). It is not a
model and not a chatbot; it's an agent runtime with:

- **Persistent cross-session memory** + a **self-improving skills system**
  (write docs → save tools → update memory → reusable skills). This maps almost
  exactly onto The Bench's archive + calibration loop.
- **MCP-native**: connects to any external MCP server. Plugin hooks:
  `pre_llm_call`, `post_llm_call`, `on_session_start`, `on_session_end`.
- Multi-platform messaging (Telegram/Discord/Slack), 40+ built-in tools.

## The integration boundary (the key insight)

Hermes **does not touch markets directly.** It drives a standalone application
**through a single MCP server**, and — quoting a working Hermes trading repo —
*"that is the whole integration boundary."* The agent prompts the MCP server in
natural language; the server exposes typed tools (`scan`, `research`, `execute`,
`state`) and does all the real work.

**Credentials live on the MCP-server side, never in the agent.** In the
reference system, broker/wallet keys sit in the server's gitignored `.env.local`;
orders are signed server-side; *"the server never exposes them to Hermes Agent or
external APIs."* → This is exactly Adam's rule: **no keys in the app.** Our
current design (endpoints + policy in `connections.json`, secrets stripped) is
already correct; the keys live one layer down, in the MCP server.

Behavior/config (mode, risk caps, sizing) lives in a tracked `agent-config.json`,
read fresh each cycle. → That's our **execution policy**.

Scheduling options observed: a continuous loop daemon (scan every N sec), or
agent-invoked ("start continuous trading"), or an hourly status cron.

## Recommended architecture for THE BENCH

Build a **Bench MCP server** (wrapping the existing `server/` chain) that Hermes
drives. One clean boundary:

```
Hermes Agent (Nous, self-hosted)
   │  natural-language prompts / scheduled cycles
   ▼
Bench MCP server  ── exposes tools ──►  run_v17 · reconcile · run_marquee
   │   (holds Robinhood connection + keys, server-side)        · execute · state
   ▼
Robinhood MCP  ──►  order placement
```

**Tools the Bench MCP server should expose:**
- `run_v17(ticker|market)` → structured verdict (analysis)
- `reconcile()` → walk the board, price rows, write `archive.json`
- `run_marquee(verdict)` → the draft (never posts)
- `state()` → the book + open triggers + calibration
- `execute(order, confirmToken)` → **gated**: runs risk gates, honors the
  execution policy (paper/live, caps, kill switch, confirm), then routes to the
  Robinhood MCP. Refuses otherwise. This is our existing `executeOrder`.

**Risk gates before any buy** (Hermes trading systems run ~11): trigger actually
fired · assumption ledger intact · Capital Competition passed · within per-trade
+ daily caps · not in kill switch · confirm token present (if required). The
Bench's edge over the reference repo: it keeps **confirm-before-buy** — the
reference system runs with *no* human approval loop; we don't.

## What changes vs. what's already right

- **Already correct:** keys never in the app; `connections.json` = endpoints +
  policy only; `executeOrder` gated; paper default + kill switch + caps + confirm.
- **Refinement:** in Settings, "Hermes" = the agent runtime connection; the
  Bench MCP server is what it drives; "Robinhood" is the downstream broker the
  Bench MCP server owns. Same three connection slots, clearer roles.
- **To build next:** wrap `server/` as an MCP server (the `run_v17 / reconcile /
  run_marquee / execute / state` tools), then point Hermes at it.

## Sources
- [Hermes Agent (official)](https://hermesagent.agency/)
- [hermes-trader — agent-to-execution via MCP (Julian-dev28)](https://github.com/Julian-dev28/hermes-trader)
- [Hermes + IBKR quant trading system (DEV)](https://dev.to/michael_zhang_39361ad72c9/building-an-ai-powered-quantitative-trading-system-with-hermes-agent-and-ibkr-476m)
- [Building a Financial Agent: Composio MCP + Hermes](https://composio.dev/content/hermes-agent-with-composio-mcp-cli)
- [Local AI Market Trader with Hermes Agent (DEV)](https://dev.to/hopebestworld/building-a-local-ai-market-trader-with-hermes-agent-41pf)

*Proof, not hype.*
