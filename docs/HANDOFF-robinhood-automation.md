# THE BENCH — ROBINHOOD AUTOMATION HANDOFF

Build spec for the trigger-monitoring service. Written for a developer picking this up cold.

**Read section 1 before writing any code. It changes the architecture.**

---

## 1. THE API SITUATION (read this first)

**Robinhood does not publish an official equities API for retail algorithmic trading.** This is the single most important constraint in the project.

What actually exists:

| Path | Status | Use |
|---|---|---|
| Robinhood **Crypto Trading API** | Official, documented, API-key based | Legitimate for crypto only (BTC, ETH, etc.) |
| `robin_stocks` / similar Python libs | **Unofficial.** Reverse-engineered from the mobile/web private API | Equities. Works, but unsupported |
| Robinhood Legend | Official desktop platform, no public API | Manual only |

Risks of the unofficial path, stated plainly:

1. **Terms of Service.** Automated access via the private API is not sanctioned. Account restriction is a real possibility. Read the current ToS before deciding.
2. **Breakage without notice.** Endpoints change; there is no deprecation policy for something that was never published.
3. **MFA friction.** Login requires device approval / SMS or TOTP. Sessions expire. Any unattended runner must handle re-auth or it silently dies.
4. **No sandbox.** There is no paper-trading environment. A bug in order code places a real order with real money.
5. **Rate limits are undocumented.** Aggressive polling can get the session throttled or flagged.

**Design consequence: v1 does NOT place orders.** It monitors and alerts. Order execution is a separate, later, explicitly-gated milestone. See section 4.

**If real automated execution becomes the goal, the correct move is a broker with an official API** — Alpaca, Interactive Brokers, or Tradier all publish documented REST APIs with paper-trading sandboxes. That decision belongs to the account owner, not the code.

---

## 2. WHAT V1 ACTUALLY DOES

A scheduled service that watches price levels and notifies. Nothing else.

```
cron (every 5 min, 8:30a-3:00p CT, Mon-Fri)
  → fetchQuotes(watchlist)          # any market data source
  → evaluateTriggers(levels)         # pure function, unit-testable
  → if fired: notify(push/SMS/email) # human decides and executes
  → appendLog(db/triggers.json)      # audit trail of every evaluation
```

**The human places every order.** The service's job is to make sure a level never gets missed, not to trade.

Data source note: quotes do **not** have to come from Robinhood. Any provider works and avoids the ToS question entirely for the monitoring layer. Robinhood's own quotes are only needed if you later automate execution there.

---

## 3. TRIGGER SPEC (current live levels)

```json
{
  "watchlist": [
    {
      "id": "B-023",
      "symbol": "NOW",
      "trigger": { "type": "hold_above", "level": 95.46,
                   "confirm_minutes": 30, "require_volume": true },
      "stop_ref": 93.00,
      "note": "Reference = Jul 22 close. Entry only if it HOLDS above after first 30 min."
    },
    {
      "id": "B-010",
      "symbol": "MU",
      "trigger": { "type": "reclaim_on_volume", "level": 950.00,
                   "volume_multiple": 1.0 },
      "note": "Reclaim must come on real volume vs 20d average, not a thin-tape gap."
    },
    {
      "id": "B-017",
      "symbol": "HYPE",
      "trigger": { "type": "breakout", "level": 77.00 },
      "invalidation": 52.00,
      "note": "Crypto. 24/7 — monitor outside market hours."
    },
    {
      "id": "B-019",
      "symbol": "PENG",
      "trigger": { "type": "reclaim", "level": 70.50 },
      "note": "Hold mid-$60s, reclaim $70-71."
    }
  ]
}
```

**`hold_above` is not `crosses_above`.** The level must be held for `confirm_minutes` after the open, not merely touched. This distinction is the entire edge of the setup — implement it literally, or the service will fire on every wick and train the user to ignore it.

---

## 4. IF EXECUTION IS EVER ADDED (gated milestone, not v1)

Do not build this until v1 has run clean for weeks and the ToS question has been answered by the account owner.

Mandatory rails, all of them:

1. **`DRY_RUN=true` by default.** Order functions log intent and return without submitting. Flipping to false requires an explicit env change plus a typed confirmation string.
2. **Hard position cap in code.** Max notional per order, max open positions, max orders per day. Reject anything over, loudly.
3. **Kill switch.** A file or env flag that halts all order paths instantly, checked before every submission.
4. **Limit orders only.** Never market orders in automated code. A market order in a gap is how small accounts get destroyed.
5. **Idempotency.** Every order carries a client-generated ID. A retry after a timeout must never double-fill.

**PDT rule — critical for a small account.** Under $25,000 equity, more than 3 day trades in 5 rolling business days flags the account as a pattern day trader and restricts it. Swing trades held overnight do not count, but an automated system that enters and exits same-day will trip this fast. Track day-trade count in code and block the 4th.

---

## 5. REPO STRUCTURE

```
bench-triggers/
├── .env.example          # keys only, never values
├── .gitignore            # MUST include .env
├── config/
│   └── watchlist.json    # the trigger spec above
├── src/
│   ├── quotes.js         # market data adapter (provider-agnostic)
│   ├── triggers.js       # pure evaluation logic — unit test this hard
│   ├── notify.js         # push / SMS / email
│   ├── guards.js         # PDT counter, position caps, kill switch
│   └── index.js          # scheduler entry
├── db/
│   └── triggers.json     # append-only evaluation log
└── test/
    └── triggers.test.js  # every trigger type, every edge case
```

---

## 6. SECURITY

1. `.env` in `.gitignore`, always. Verify before first push.
2. **Never commit credentials.** Not brokerage, not API keys, not session tokens.
3. Store any session token encrypted at rest, never in the repo.
4. Make the repo **private**. It contains an open trading book.
5. Before sharing access: `git log -p | grep -iE "sk-|api[_-]?key|password"`.

---

## 7. BUILD ORDER

1. `triggers.js` + tests. Pure functions, no network. Prove `hold_above` behaves correctly on synthetic candles.
2. `quotes.js` against any free provider. Log only.
3. `notify.js` — get one real alert to a phone.
4. Scheduler + `db/triggers.json` audit log. Run it for a week, alerts only.
5. Only then discuss execution, with section 4's rails and a ToS decision in hand.

**Ship step 4 and stop.** An alerting service that never misses a level is most of the value with none of the risk. The human placing the order is a feature.

---

*Not legal or financial advice. Confirm broker ToS and applicable regulations before automating anything against a live account.*
