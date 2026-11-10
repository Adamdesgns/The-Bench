# Bench ticker strip

A thin scrolling ticker docked right above the Windows taskbar, so what the desk is watching is on screen all the time. Built 2026-11-09 at Adam's ask: "build my stock tickers into a desktop wallpaper ... or into my task bar so we see what we're watching at all times."

It only reads. It never places an order, never reads an account and never sends anything to the phone.

## What shows

`scripts/ticker-feed.mjs` picks up to 16 symbols, in this order:

| Dot | What | From |
|---|---|---|
| grey | SPY, QQQ, SMH (the market itself) | always |
| purple | your pins | `db/ticker-pins.json` |
| orange | pump watches that are live or still ahead | `db/pump-watch.json` |
| blue | stack-lane names | `db/stack.json` |
| yellow | watchlist names that could turn into a trade soon (HIGH-ALERT, HOT-ACCUMULATE, ARMED..., STALK, QUEUE) | `db/watchlist.json` |

Each one shows the last regular-session price, the day's change, and the after-hours or pre-market move when there is one. Prices are Yahoo's free feed. A symbol whose quote failed keeps its last good price in grey. The time beside BENCH is when quotes were last pulled; it turns amber when they are old.

To change the list, make `db/ticker-pins.json`:

```json
{ "pin": ["TSLA", "AMD"], "hide": ["XOM"], "max": 16 }
```

## Using it

- Hover: the scroll pauses.
- Click a ticker: opens it on robinhood.com.
- Right-click: refresh now, pause scrolling, quit.
- It steps aside while a full-screen app (a game, a video) is up.

It starts at login from a shortcut called "Bench Ticker" in your Startup folder. `install-ticker-strip.ps1` makes that shortcut and `install-ticker-strip.ps1 -Remove` deletes it. `ticker-strip-launch.vbs` starts the strip by hand. Only one copy runs at a time.

## How it works

- `TickerStrip.cs` is a small Windows program that `ticker-strip.ps1` compiles each time it starts, so there is nothing to install or build. It registers as an "app bar", the same Windows mechanism the taskbar uses, which is why maximized windows stop above it.
- Every 60 seconds from 4am to 8pm New York time on weekdays (every 10 minutes otherwise) it runs `scripts/ticker-feed.mjs` hidden, which writes `db/ticker-feed.json` (not committed, it changes every minute).
- The same run hands a copy of the quotes to the Grok Bot wallpaper (`Bot Status\wallpaper-3d\tickers.json`) and refreshes the wallpaper's pod trading floor (`Bot Status\pod-desks.mjs`).

Tests: `node --test test/ticker-feed.test.mjs`.
