# Market Watch: the nag that stops at a selfie

Design approved by Adam in chat, 2026-10-07 ("Yes option 1" / "Sounds good"). Written by Claude.

## What it is, in one paragraph

A watcher that runs on this PC during the regular session, checks every committed buy and sell level in the book the way `scripts/tripwire.mjs` already does, and when one is hit sends a card to Adam's phone that keeps coming back until he sends a photo of himself. The card opens this Claude chat on his phone. The photo means "I saw it" and nothing more: it is never permission, and every order stays Adam's.

Adam's words for the trigger: "the cards where a level is hit for a buy or a level hit for a sell." Narration reads (pre-market, midday, close) are not part of this and stay one-and-done.

## Why

The tripwire pings once. An urgent ntfy card that rings once at 9:15 and is not seen until 11:00 is the same as no card. On 2026-08-19 GDS round-tripped its stop between two checks; on 2026-09-16 MRVL closed over its re-arm line and nobody looked (B-771). The missing piece is not detection, it is an acknowledgment loop: the phone keeps asking until a human proves they looked.

## Decisions already made

- Option 1 of three: grow the tripwire into an all-day watcher. Not a phone app, not Claude routines (one Claude session per nag is about 78K tokens).
- Only buy and sell level hits nag. Which levels count is exactly what `tripwire.mjs` watches today: TRIGGER (conditional rows), STOP and FLOOR (invalidation on long / conditional rows and watchlist floors), BUY ZONE (watchlist), TARGET (`position-target.mjs`). This spec does not change level selection or its three gates (latest row, watchlist kill switch, 14-day staleness).
- A photo clears the alarm. Text does not. The only non-photo escape is `--ack` run on this PC.
- Free price feed (Yahoo, same as the tripwire), regular hours only, PC must be on. Robinhood MCP is chat-only and cannot be read by a script.
- Zero dependencies, Node, lives in `scripts/` of The Bench beside the tripwire. Runs from the live checkout, never a worktree (it reads the live book).

## Components

### 1. `scripts/market-watch.mjs` (new)

Modes:

- `--loop` : the daemon. Weekdays, from 08:25 to 15:05 CT. Every 3 minutes it does one tick. Sleeps outside the window and exits after 15:05.
- `--once` : one tick, then exit. For tests and hand checks.
- `--status` : print open alarms, the nag schedule position, the ack topic state. No network.
- `--ack [--from chat|pc] [--note "..."]` : clear every open alarm from this PC. Used by Claude when the selfie arrived in chat, or by Adam at the keyboard.
- `--init` : create the local config (below) with a fresh random ack topic. Refuses to overwrite.
- `--link <url>` : update the chat link in the local config.
- `--dry` : do the tick, send nothing, write nothing.
- `--reset` : clear the state file.

One tick:

1. If `apps/x-poster/HALT` exists or the local config has `halt: true`, do nothing.
2. Run the tripwire check as a module call (see component 2). Get the list of levels tripped today.
3. Any tripped level not already inside an open alarm opens one (or joins the open alarm if one exists: one alarm per burst, so several levels hitting together make one nag).
4. Poll the ack topic since the alarm opened. A message whose `attachment.type` starts with `image/` acks every open alarm. Record who and when.
5. For every open, unacked alarm, if the schedule says it is time, send the card.
6. Write state.

### 2. `tripwire.mjs` split

The level derivation and the price check move into `server/tripwire.js` as functions (`deriveLevels(rows, watchlist, targets, today, opts)`, `checkLevels(levels, quotes, today, state)`), and `scripts/tripwire.mjs` becomes a thin CLI over them with exactly its current behavior and flags. `market-watch.mjs` imports the same functions. The tripwire's state file and exit codes do not change. Existing tripwire behavior is covered by the new tests before the split and must pass unchanged after it.

### 3. The card

ntfy POST to `https://ntfy.sh/bench-adam-7x3`, same topic as every other Bench card.

- `Priority: urgent` (Adam, 2026-09-11: all cards urgent).
- `Title`: `THE BENCH - BUY level hit: VST 143.02` or `SELL level hit: GOOGL 326.00`. TRIGGER and BUY ZONE are BUY; STOP, FLOOR and TARGET are SELL. A mixed burst is titled `BUY + SELL levels hit`.
- Body: one line per level (`VST TRIGGER >= 143.02, touched 143.40 at 09:14 CT, row B-717`), then the nag count (`nag 3 of many`), then the fixed last line: `Send a selfie to stop this. It means you saw it, nothing else. Every order is yours.`
- `Click`: the chat link from the local config.
- `Tags`: `rotating_light`.

Nag schedule, minutes after the alarm opened: 0, 2, 5, 10, then every 15. Each send is recorded. Sends stop at 15:05 CT; the alarm stays open and unacked.

### 4. The ack topic

A second ntfy topic, name `bench-ack-` plus 12 random characters, created by `--init` and stored only in the local config. Adam subscribes to it in the ntfy app once. The watcher reads it with `GET /<topic>/json?poll=1&since=<alarm open time>`, the same read the executor arm switch uses.

Ack rule: a message with an `attachment` whose `type` begins with `image/`, posted after the alarm opened, clears all open alarms. The watcher stores the attachment URL and time on the alarm as the receipt. A text message on the ack topic is logged and ignored. Nothing is ever downloaded or kept locally; the receipt is the URL and timestamp.

### 5. The chat path

Adam can also send the photo into this Claude chat from his phone (Remote Control is on for this session). Claude confirms a photo arrived, runs `node scripts/market-watch.mjs --ack --from chat`, then re-pulls the level live from Robinhood and runs it under the framework. The ack is recorded with `from: "chat"` so the two paths are distinguishable in the log.

### 6. Local config and state (never in git)

`db/market-watch.local.json` (gitignored):

```json
{ "ack_topic": "bench-ack-xxxxxxxxxxxx", "chat_link": "claude://claude.ai/epitaxy/local_...", "halt": false }
```

`db/market-watch-state.json` (gitignored, append-only alarm history):

```json
{ "alarms": [ { "id": "2026-10-07-0914", "opened": "2026-10-07T14:14:00Z", "levels": [ {"ticker":"VST","kind":"TRIGGER","price":143.02,"dir":"above","touched":143.4,"src":"B-717"} ], "sent": ["2026-10-07T14:14:05Z", "2026-10-07T14:16:05Z"], "acked": null } ] }
```

`acked` becomes `{ "at": "...", "from": "phone" | "chat" | "pc", "receipt": "<attachment url or note>" }`.

### 7. Close of day and the next morning

At 15:05 CT the loop exits. Any alarm still unacked is left open. The next weekday at 08:25 the loop starts and, before its first tick, sends one card titled `UNANSWERED from <date>` listing the open alarms, with the same selfie line. Those alarms then follow the normal schedule. `bench-premarket-post` is not changed; the carry-over is the watcher's own card.

### 8. Launch

A Windows scheduled task, `Bench Market Watch`, weekdays 08:25 CT, runs `node scripts/market-watch.mjs --loop` from the live checkout. Created by Claude with Adam's go, as an auditable `.ps1` he can read first (the standing pattern). Nothing else starts it.

### 9. Errors

- Price feed fails for a ticker: that ticker is skipped this tick, logged once per ticker per day, no alarm opened or closed because of it.
- ntfy send fails: logged, the send is not recorded, the schedule tries again next tick.
- Ack topic read fails: alarms stay as they were; no ack is inferred from silence.
- Any exception inside a tick is caught; the loop never dies from one bad tick. Three consecutive failed ticks send one card titled `MARKET WATCH DOWN` (not a nag; it does not repeat).

### 10. Tests (`test/market-watch.test.mjs`, offline)

Fake fetch injected for Yahoo and ntfy. Cases: the nag schedule (0/2/5/10/15); one alarm per burst; a second level during an open alarm joins it; image attachment acks, text does not; an attachment older than the alarm does not ack; no sends after 15:05; the unanswered card next morning; HALT stops everything; feed failure skips without closing; `--ack --from chat` records the source; the split tripwire still passes its existing behavior (levels derived, day-range trick, state file, exit codes).

## Verify before building past Task 1

1. The ntfy app on Adam's phone can attach a photo when publishing to a topic. Android can; iPhone cannot. If it cannot, the fallback is the chat path only, and the spec is amended.
2. The card's `Click` link opens this session on the phone. First try the session link `claude://claude.ai/epitaxy/<session id>`; if the phone does not open that scheme, use the claude.ai web link for the session. The link lives in the local config (`--link`) because it points at one session and will change.

## Out of scope

Changing which levels are watched. Pre-market or overnight coverage. Any order placement. Reading the selfie itself. Routines nagging.

## Open loop carried from the design chat

The live branch `v29-hunter-handoff` is ahead of GitHub (15 commits as of 2026-10-06 night). Push before any cloud run.
