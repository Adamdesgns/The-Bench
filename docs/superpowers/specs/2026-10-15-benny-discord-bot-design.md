# Benny on Discord — design

**Date:** 2026-10-15 · **Status:** design approved in chat, not built · **Owner:** Adam

Benny is the persona of The Bench (`prompts/benny-v2.md`): the research system speaking for itself, in the first person. Today the work runs privately, and the phone reads go to Adam alone. This design brings Benny back as a public teacher on a Discord server for Adam and his followers. Benny runs on his own every trading day: he posts the board, his paper trades, his misses and one lesson a night, and he answers Adam's questions. Benny never places a real order.

## Decisions (Adam, 2026-10-15)

| Question | Answer |
|---|---|
| Who places real orders? | **Paper first.** Benny trades paper only. Adam places any real trade himself. Real execution is not in this design. |
| Who is Benny teaching? | **A public channel for Adam and followers.** |
| Where? | **Discord.** Bots are allowed there. X is out: @TheBenchTrades was suspended 2026-09-02 for "inauthentic behavior", and a new account risks being treated as dodging that ban. |
| Who can ask Benny questions? | **Adam now, followers later.** |
| How is it built? | **On top of the existing Bench, on this PC.** No new standalone app and no cloud. |
| Benny's paper account | **His own account, starting at $10,000.** It is separate from Adam's paper book (`db/paper-book.json`), which stays private and unchanged. |

## Open decision: risk per trade

Adam, 2026-10-15: *"We are not decided exactly the trading %s we will start with a 10k bag but we're still deciding. Waiting on a new addition to finish."*

- The risk per trade is one setting, `risk_pct` in `db/benny-config.json`. It starts as `null`.
- **While it is `null`, Benny's book refuses to size or take any trade.** #paper-trades still posts each trade plan (entry, stop, targets, why) with the size marked "sizing starts when the risk setting is chosen."
- Benny's book opens at $10,000 on the day `risk_pct` is set. Its record starts then, not before.
- Only Adam sets it, in a chat, in his own words. That chat writes `risk_pct` and runs `benny-book.mjs open --risk-pct N`, which writes `risk_pct` and opens the book at $10,000 (`paper-book.mjs init --balance 10000 --db db/benny-book.json`; the command name comes first, so `--db` goes after it) in the same step. No routine and no Benny answer may change it.

## Hard rules

1. **Benny never places a real order.** He has no order tools: not in the routines, not in the listener. The executor (`executor/executor.mjs`) is not connected to any part of this.
2. **The wall.** Nothing from Adam's real accounts reaches Discord: no balance, no buying power, no positions or share counts, no cost basis, no orders, no account numbers or nicknames, nothing about the kids' UTMA. A code check enforces this, not the prompt alone (see "The wall check").
3. **Paper only, and say so.** Every post ends with the sign-off in `benny-v3.md`. Every trade is labeled paper.
4. **The five refusals from benny-v2 stay:** no flattering number, say what is not being claimed, no invented numbers, no names that are not on the board, never tell anyone what to buy or sell.
5. **Misses post as loudly as wins.** Same channel, same size.
6. **Paper Desk stays separate.** Benny reads only The Bench. He never touches `Projects\experiments\paper-desk`.
7. **LOG IT still applies.** Benny posts what the routines already logged. In the first phase he makes no new forward claims in answers: an answer that discusses a level cites the existing row (B-###), prediction (PR-###) or watcher (MC-###). New calls come only from the routines, which log them.

## The server

Six channels. Each one is fed by routines that already run, so no new scheduled task is added.

| Channel | What posts there | Fed by (routine, CT) |
|---|---|---|
| #morning | The pre-market read, how the open went, and on Sundays the week ahead | bench-premarket-post 5:34a, bench-state-of-market-post 8:44a, bench-weekly-catalyst Sun 11:07a |
| #paper-trades | Every paper entry, stop, target and exit as it happens, with the plan and the reason | bench-entry-check-open 9:11a, bench-plan-check-close 3:29p, bench-hunt-close 3:35p |
| #close | The closing read and the evening hunt | bench-closing-bell-post 3:12p, bench-hunt-close 3:35p |
| #lesson | One lesson a night: one idea, defined plainly, tied to a real logged call | bench-quote-tweet-nightly 8:26p (it keeps drafting Adam's own @adamdesgns post too) |
| #scorecard | Saturday: the week's record with misses first, Benny's paper account by lane, and the prediction ledger's hit rates by source (desk, hunters, Adam) | bench-week-recap Sat 11:09a |
| #ask-benny | Adam asks and Benny answers. Followers can read. | benny/listener.mjs (always on) |

These stay private and post nothing to Discord: midday, power hour, trending scan, fast-mover watch, calendar nag, the pre-pump jobs.

## Components

### 1. `prompts/benny-v3.md` — the persona for Discord

A new file. v2 stays on disk, unchanged. v3 keeps v2's sections 0 to 5 (audience, who he is, voice, the five refusals, being wrong) and changes the following:

- **Platform:** Discord. No 280-character parts, no one-cashtag rule, no @TheBenchTrades. A post can be up to 2,000 characters per message, and longer posts split into numbered parts.
- **The operator:** Adam is still "my operator." Benny trades paper. He never says what Adam holds or trades, and if asked he says it is private.
- **Sign-off (fixed, never paraphrased):** `Paper trades only. Not financial advice. Educational only.`
- **Answering a question (replaces v2 §6):** re-pull prices first, answer only the question asked, cite rows, "I don't know" is complete, refuse anything off the board.

### 2. Benny's paper account — `db/benny-book.json`

- The existing `scripts/paper-book.mjs` runs this book with `--db db/benny-book.json`, so the scoring rules are identical: stop first on a day that touches both, a gap through the stop exits at the open, the first target sells half, out on the exit date.
- **New: `scripts/benny-book.mjs mirror`.** It reads Adam's paper book, finds trades Benny's book does not have yet, and adds each one with the same entry, stop, targets, exit date and lane. Shares = floor(Benny's equity × `risk_pct` ÷ |entry − stop|). A trade that comes out under one share is skipped and the skip is posted. It refuses to add anything while `risk_pct` is `null`.
- The routines run `mirror` right after they add to Adam's book, and score Benny's book right after they score Adam's.

### 3. `scripts/benny-post.mjs` — the only door to Discord

```
node scripts/benny-post.mjs --channel morning --file docs/benny/2026-10-16-premarket.md [--dry-run]
```

- Reads the post as UTF-8, runs the wall check, splits it at paragraph boundaries into parts of at most 2,000 characters, and sends each part to that channel's webhook (a private posting address Discord gives each channel).
- **Mode** comes from `db/benny-config.json`. In `dry` mode it sends to Adam's phone (ntfy topic `bench-adam-7x3`, titled "BENNY DRY RUN") instead of Discord. In `live` mode it sends to Discord.
- **Refuses, and pings Adam's phone with the reason, when:**
  - the wall check fails;
  - the sign-off is missing;
  - the text has a placeholder (`TBD`, `TODO`, `{{`, `XX.XX`);
  - the same file, or the same text, was already posted (`db/benny-posts.json`);
  - a `benny/HALT` file exists.
- Appends every send and every refusal to `db/benny-posts.json`: date, channel, file, parts, outcome.
- Zero dependencies, like `ntfy-read.mjs`.

**The routine change.** Each routine in the server table gets one added step at the end, in a `BENNY STEP` block. The step does three things in order:
1. Refreshes `~/.benny/wall.json` from a read-only account pull (positions and balance).
2. Writes Benny's public version to `docs/benny/<date>-<slot>.md` from public facts and Benny's book only.
3. Runs `benny-post.mjs`. The private read and the ntfy ping are unchanged. Each SKILL.md gets a dated backup before the edit (`SKILL.md.bak-<date>-benny`), the same way the v34 and v35 repoints were done.

### 4. `benny/listener.mjs` — Ask Benny

An always-on program on this PC that connects to Discord as the Benny bot. It uses the discord.js library (free, MIT), installed in `benny/package.json` so the Bench's `scripts/` stay zero-dependency.

- Listens only in #ask-benny. Answers only messages from Adam's Discord user ID. **Every other author is ignored silently.**
- For each question it runs Claude Code headless (`claude -p`) with `prompts/benny-v3.md`, the question, and a fixed tool allowlist:
  - file reads over the repo (Read, Grep, Glob);
  - read-only market data (equity and crypto quotes, historicals, earnings calendar).
- **No Bash, no file writes, no broker order or account tools.** A test enforces this by listing the tools the session can see and failing on anything outside the allowlist.
- **Tool lockdown (added 2026-10-15).** A plain `claude -p` loads every MCP server configured on this PC, and the Robinhood server carries order and account tools beside the quote tools. So the listener never relies on the prompt or on defaults:
  - It starts Claude with `--strict-mcp-config --mcp-config benny/mcp.json`, and `benny/mcp.json` lists the Robinhood server only. No other MCP server loads, and claude.ai connectors are not used.
  - It passes `--tools` with the exact built-in tools (Read, Grep, Glob) and `--allowedTools` with each permitted Robinhood tool **by its full name**, one by one (`mcp__robinhood-trading__get_equity_quotes`, `..._get_crypto_quotes`, `..._get_equity_historicals`, `..._get_earnings_calendar`). Never the whole server (`mcp__robinhood-trading`), never a wildcard.
  - It also passes `--disallowedTools` naming every Robinhood order, cancel, account, position, portfolio and order-history tool, so a mistake in the allow list still cannot reach them.
  - It runs with `--permission-mode dontAsk`, so anything not allowed is refused instead of waiting for a click.
  - The allowlist test reads the `init` message of a real `claude -p --output-format stream-json` run (it lists every tool the session can see) and fails if any name is outside the allowlist, or if any name containing `place_`, `cancel_`, `get_accounts`, `get_portfolio`, `get_equity_positions`, `get_equity_orders` or `get_option_positions` appears.
- The program, not Claude, posts the answer, and only after the same wall check `benny-post.mjs` uses. The program appends the fixed sign-off to every answer.
- Logs every question and answer to `db/benny-qa.json`.
- At most 20 answers a day. Past that it replies "done for today."
- `!halt` from Adam writes `benny/HALT`, which stops all posting and the listener's answers. `!resume` removes it.
- Starts at Windows login via Task Scheduler (set up only with Adam's OK during the build). If it stops, it pings Adam's phone.

### Settings

| File | In the repo? | Holds |
|---|---|---|
| `C:\Users\steam\.benny\discord.json` | **No, never committed** | the six channel webhook URLs, the bot token, Adam's Discord user ID. Adam pastes these himself. |
| `C:\Users\steam\.benny\wall.json` | **No** | the real-account facts the wall check blocks (see below), refreshed by every BENNY STEP before it posts |
| `db/benny-config.json` | Yes | `mode` (`dry` or `live`), `start_balance` 10000, `risk_pct` (null until Adam sets it), the daily answer cap |
| `db/benny-book.json`, `db/benny-posts.json`, `db/benny-qa.json` | Yes | Benny's paper book, the post log, the Q&A log |

## The wall check

One function, shared by `benny-post.mjs` and the listener. A post fails if it contains any of the following:

1. **Account identifiers:** `6137`, `7724`, "Agentic", "UTMA", "custodial", "buying power", "margin account".
2. **Real numbers from `~/.benny/wall.json`:**
   - the real total balance and buying power, matched within 0.5% in any common format (`3,512.31`, `3512`, `$3.5K`). A value under $100 matches only its exact two-decimal form (`42.17`), so a tiny buying power cannot block every small number in a post;
   - each real holding's share count next to its ticker (`8 GOOGL`, `8 shares of GOOGL`);
   - each real holding's cost basis (`336.25`).
3. **Possessive account phrases about Adam:** "Adam's account", "Adam's position", "my operator's account", "Adam holds", "Adam bought", "Adam sold".

Every BENNY STEP refreshes `wall.json` before it posts, so the file follows the real account. If `wall.json` is missing or more than 4 days old, every post and every answer is refused. Four days covers a weekend plus a Monday holiday, and the check fails closed.

Tickers alone are allowed. Benny can teach about GOOGL as a stock on the board. He cannot say Adam owns it or how much.

A stock priced near the real balance (one trading around 3,500, for example) will trip the number match. That is accepted: the post is refused and Adam gets pinged, which is the safe direction to be wrong in.

## What Adam sets up (about 15 minutes)

1. Create a free Discord server with the six channels.
2. For each channel: Channel settings → Integrations → Webhooks → New Webhook → Copy URL.
3. In the Discord Developer Portal, create an application named Benny, add a bot, and copy its token. Turn on **Message Content Intent** on the Bot page (without it the bot sees empty messages). Invite it with permission to read and send messages in #ask-benny only.
4. Paste the six URLs, the token and his Discord user ID into `C:\Users\steam\.benny\discord.json`. Claude creates the empty template and never handles the token.

## Testing and rollout

| Stage | What happens | Moves on when |
|---|---|---|
| **1. Offline tests** | Wall check: fixtures with each identifier, the balance in four formats, share-count-plus-ticker and cost basis are all refused, and a clean lesson passes. Splitting stays under 2,000 characters. Repeat posts are refused. HALT stops everything. `mirror` refuses while `risk_pct` is null and sizes correctly once it is set. The listener ignores non-Adam authors, and its tool list contains nothing outside the allowlist. | All tests pass (`node --test test/benny-*.test.mjs`) |
| **2. Dry run** | `mode: dry`. Every Benny post goes to Adam's phone and `docs/benny/` instead of Discord. | 3 trading days, Adam reads them and says go |
| **3. Private server** | `mode: live`, Adam is the only member, #ask-benny is working for him. | 1 week |
| **4. Followers in** | Adam invites people. They read, and Benny answers only Adam. | Adam's call |
| **5. Followers ask** | Separate design and plan (see Later). | — |

**Done means:** 5 straight trading days in stage 3 with every scheduled slot posted, zero real-account details reaching Discord, and, once `risk_pct` is set, Benny's book holding every trade Adam's paper book took.

## Later (not in this build)

- **Followers can ask.** Needs per-person limits, a check that refuses tickers not on the board, prompt-injection tests on hostile questions, and a check of Anthropic's terms, because Adam's Claude subscription is for his own use and answering the public may need the paid API. Cost goes through Free First before any money is spent.
- **Real execution.** Out of scope. If it ever comes back, it goes through `docs/executor-test-protocol.md` and Adam's per-order typed confirmation. Benny never presses the button.
- **X.** Stays off unless the 9/2 appeal succeeds.

## Out of scope

Real orders. A new standalone app. Cloud hosting. Changing Adam's 10% band or his paper book. Paper Desk. Any public post about Adam's real account.
