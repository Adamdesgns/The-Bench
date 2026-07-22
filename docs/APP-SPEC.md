# THE BENCH — APP SPEC (locked)

**What it is:** an operator console for running THE BENCH v17. Not a passive
dashboard — you *run the framework through it*, and every information grab lands
in its own window. Styled as a **macOS-style desktop**, painted in the Bench
skin.

**Analysis ends at a reviewable draft. Execution is a separate, gated path:**
agents place buys through the Robinhood MCP connection, governed by the
execution policy (paper default, kill switch, per-trade/daily caps, confirm).
**No keys ever live in the app** — see `docs/EXECUTION.md`.

---

## 1. DESIGN LANGUAGE — "Bench OS"

macOS desktop metaphor, Bench brand skin.

- **Window chrome:** rounded (10px) windows, soft drop shadow, subtle vibrancy
  on the title bar. Traffic-light buttons top-left — recolored to brand:
  **close = loss-red `#E5484D` · minimize = gold-dim `#9A7E28` · zoom = gold
  `#D4AF37`** (no green, ever). Draggable by the title bar; focus brings to
  front; zoom/minimize supported.
- **Menu bar:** thin bar across the very top — Bench seal + app menus
  (Run · Board · View · Window). Right side: live CT/ET clock + Data-Integrity
  status light.
- **Ticker banner:** NYSE-style scrolling strip directly under the menu bar —
  open board + peer check (KOSPI, SKHY, TSMC, ASML) + macro (WTI, US10Y, DXY,
  VIX, gold, BTC, ETH). Live; each token tagged live/delayed/not-observable.
- **Dock:** bottom center — one icon per window type; click opens/focuses.
- **Palette / type:** exact brand tokens — Ink `#111111`, Card `#1A1916`,
  Edge `#26241F`, Gold `#D4AF37`, Gold-dim `#9A7E28`, Pale `#F5ECCB`,
  Bone `#E8E4DA`, Slate `#8F8A7A`, Loss `#E5484D`. **No green.**
  EB Garamond (display) · Inter (UI) · JetBrains Mono (numbers). Seal −8°.

---

## 2. THE SPINE — RUN CONSOLE

The command bar that drives everything:

- `Run $TICKER` · `Run options $TICKER` · `Review B-###` · `run the market` ·
  `refresh board`.
- Session-start pickers (tappable): **Account size · Instrument · Risk
  posture** — skipped in Research / Battle-Test Mode.
- A run streams into the windows below as each step of the chain completes
  (v17 → reconcile → Marquee), with a Data-Integrity strip showing source and
  AV-budget remaining.

---

## 3. THE WINDOWS (each = a macOS window)

| Window | Feeds from | Shows |
|---|---|---|
| **Two-Lens** | v17 Lens 1 + 2 | Chart (trend, structure, 20/50/200, RSI/MACD, Trend Strength 0–10) · Mood (regime, Market Risk, sector, Earnings Quality, Institutional Lens, insider) |
| **Market Sentiment** | v17 regime block | Regime, Fear & Greed, Market Risk 1–5, sector flow, FOMO Clock, chips↔crypto seesaw |
| **Catalyst Watch** | `calendar_next_10d` | Earnings, FOMC, dated overhangs — each with a live countdown |
| **Live Charts** | data feed (backend) | Candles + MAs for the reviewed ticker and any open row |
| **Global Peer Check** | v17 Institutional Lens | Samsung/SKHY/TSMC/ASML/LVMH/Toyota/BYD/BHP/Rio overnight — confirms or contradicts |
| **Bench Verdict** | v17 scorecard | Score, 4 grades, Trend Strength, FOMO, Market Risk, Relative Opportunity, Confidence/Conviction, Trade Plan, The Trap, Final Call, HODL |
| **Capital Competition + Assumptions** | v17 gate + ledger | vs cash/market/watchlist; logged assumptions intact/strained/broken; Delta re-run armed on a break |
| **Marquee Draft** | Marquee v3.1 | Six-part output in separate copy boxes + lint status; No-Story caption when no gap. **No post button.** |
| **Options Flow** *(gated)* | `Run options` only | Sweeps, OI, skew, IV rank, crush risk |
| **Archive / XLSX** | `db/archive.json` + `archive-v4.xlsx` | The book rendered; xlsx viewable + downloadable in-app |
| **Calibration** | closed rows | Confidence buckets vs actual win rate, engine mix, closes-toward-30 |

**Baked in everywhere (not windows):**
- **Two-bucket toggle** — swing vs long-term/UTMA, never mixed.
- **Data-Integrity strip** — every value tagged live / unverified / not-observable + source (AV/Stooq) + AV budget.
- **Execution gates** — buys route only through the Robinhood MCP and only when the execution policy allows (see `docs/EXECUTION.md`). Analysis never places orders.
- **Settings — Connections** window — MCP endpoints for Claude · OpenAI · Hermes agents · Robinhood, plus the execution policy. No keys stored.

---

## 4. DATA / BACKEND

- **Now (static + hydrate):** windows render from the embedded book; when served
  next to `db/archive.json` they hydrate live.
- **Backend (next):** rebuild the runner chain (the removed `server/`) behind the
  app — `Run` triggers v17→Marquee, prices refresh the banner + charts, closes
  update calibration. Dual provider (OpenAI / Anthropic). Alpha Vantage budget +
  Stooq fallback. The chain ends at a draft; the app never posts.

---

## 5. BUILD ORDER

1. **Shell** — menu bar, ticker banner, dock, draggable Bench-OS windows, brand traffic lights.
2. **Data windows** — Archive/XLSX, Market Sentiment, Catalyst Watch, Two-Lens, Calibration (render from the book).
3. **Run Console** — command bar + session pickers wired to a backend stub.
4. **Backend** — reconnect the v17→Marquee chain; live banner + charts.
5. **Live Charts + Options Flow** — last, once the feed is in.

*Proof, not hype.*
