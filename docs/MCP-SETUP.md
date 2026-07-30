# THE BENCH — MCP SETUP

The data layer. Which servers feed which part of v17, what they cost, and the
order to connect them in.

**Connect one at a time and verify each before adding the next.** Six at once
means you won't know which one broke.

---

## 1. THE SPLIT THAT DECIDES EVERYTHING

There are two kinds of MCP server and only one reaches your phone.

| Kind | Added where | Reaches mobile? |
|---|---|---|
| **Remote** (`http` / `sse`) | claude.ai → Settings → Connectors → Add custom connector | **Yes** — syncs to mobile + desktop |
| **Local** (`stdio`, runs via `npx`/`uvx`) | Your PC, via `claude mcp add` or this repo's `.mcp.json` | **No** — that machine only |

Mobile can *use* remote servers already added at claude.ai. It cannot *add*
new ones. So the free filing/macro servers live on the PC, and the phone is
for reading output and approving trades.

---

## 2. WHAT EACH ONE FILLS IN v17

| v17 section | Weight | Server | Cost |
|---|---|---|---|
| Data Integrity — Review Price + live print | gate | **Robinhood** | free |
| Lens 2 — Insider / Form 4, 13F, Institutional Lens | **20 pts** | **SEC EDGAR** | **free, no key** |
| Lens 2 — market regime, Market Risk Score | 15 pts | **FRED** | free (free key) |
| Crypto appendix (B-011–B-018) | — | **CoinGecko** | **free, no key** |
| Fundamentals / Earnings Quality fallback | 15 pts | Alpha Vantage | free, 25 calls/day |
| Options Flow *(gated — explicit request only)* | — | Unusual Whales | **paid** |

The Institutional Lens is the biggest hole. It is 20 points of the Opportunity
Score and it currently scores as "not observable" on every run. SEC EDGAR
closes it for free.

---

## 3. ORDER OF OPERATIONS

### Step 1 — Robinhood (remote, do this alone first)

The live print. Every v17 review opens with it.

On a **computer** (mobile cannot add servers):

claude.ai → Settings → Connectors → **Add custom connector**

```
https://agent.robinhood.com/mcp/trading
```

Approve the OAuth handoff in Robinhood. It authenticates through Robinhood's
own login — no password touches the agent. Then it syncs to mobile.

**Verify:** ask for a quote on one ticker. Stop here until that works.

Tools: `get_accounts` · `get_portfolio` · `get_equity_positions` ·
`get_equity_quotes` · `get_equity_orders` · `search` · watchlist tools ·
`review_equity_order` · `place_equity_order` · `cancel_equity_order`

> `place_equity_order` is real order authority. It is walled to the Agentic
> sub-account only, Robinhood prompts per action, and you can disconnect from
> the app. Keep the execution gates in `server/settings.js` aligned with the
> real balance.

### Step 2 — CoinGecko (remote, free, no key)

Eight crypto rows have been stale since the seed. This fixes them at zero cost,
and being remote it reaches mobile too.

claude.ai → Add custom connector:

```
https://mcp.api.coingecko.com/sse
```

### Step 3 — Alpha Vantage (remote, free tier)

Already in the claude.ai connector directory — search and click. One-click,
no URL to paste. `server/dataProviders.js` already targets it, and the
25-call/day budget ledger in `db/av-usage.json` is already built.

### Step 4 — SEC EDGAR (local, PC only, free, no key)

The Institutional Lens and insider Form 4 check.

SEC requires a user-agent identifying you — that is SEC policy, not an API key.
No signup, no cost.

```powershell
setx SEC_EDGAR_USER_AGENT "Your Name (your@email.com)"
```

Then from the repo root, local Claude Code reads `.mcp.json` automatically.
Or add it by hand:

```
claude mcp add sec-edgar -s user -e SEC_EDGAR_USER_AGENT="Your Name (your@email.com)" -- uvx sec-edgar-mcp
```

Needs `uv` installed (`pip install uv`). A Docker image also exists:
`stefanoamorelli/sec-edgar-mcp:latest`.

### Step 5 — FRED (local, PC only, free key)

Fed funds, the 10/30-year, macro. Feeds the Market Risk Score. Relevant right
now with a hawkish hold, three dissents for a hike, and the 30-year at 5.2%.

Free key: https://fred.stlouisfed.org/docs/api/api_key.html

```powershell
setx FRED_API_KEY "your_key_here"
```

```
claude mcp add fred -s user -e FRED_API_KEY=your_key -- npx -y fred-mcp-server
```

There are several FRED implementations (kablewy npm, stefanoamorelli PyPI). If
the npm one fails, try `uvx fred-mcp-server`.

### Step 6 — Unusual Whales (remote, PAID) — not yet

33 tools: options flow, dark pool, congress trades, ETF flows, volatility.

```
claude mcp add unusualwhales --transport http https://api.unusualwhales.com/api/mcp -H "Authorization: Bearer YOUR_KEY"
```

**Hold off.** v17 gates Options Flow behind an explicit "Run options $TICKER"
and treats flow as confirmation only, never a standalone reason to trade. It
requires a paid subscription, and a monthly data bill against a sub-$1K book is
a large share of the account. Revisit at $5K+.

---

## 4. THIS REPO'S `.mcp.json`

`.mcp.json` at the root declares robinhood, coingecko, sec-edgar and fred.
Local Claude Code picks them up when you open the repo.

**No secrets are in it.** Keys resolve from environment variables at launch
(`${FRED_API_KEY}`, `${SEC_EDGAR_USER_AGENT}`). Set those with `setx` as above
and never paste a real value into the file — it is committed.

Unusual Whales is deliberately absent: it needs a bearer token in a header, and
that does not belong in a committed file.

---

## 5. VERIFY

After each connect, one check:

| Server | Check |
|---|---|
| Robinhood | pull a quote for a single ticker |
| CoinGecko | pull BTC spot |
| Alpha Vantage | pull one daily series |
| SEC EDGAR | pull the most recent Form 4 for any ticker |
| FRED | pull the 30-year Treasury yield |

If a run still reports "not observable" for insider or macro data after step 5,
the server is registered but not resolving — check the env var, not the config.

*Proof, not hype.*
