# THE STACK LANE v1 (2026-11-09)

Adam, after AMZN ran from 240 to 270: "shoulda been stacking amazon at 240", then "Build it".

## What it is

The swing desk answers one question: is this a 2:1 trade right now. It is right to say no to most things, and a no from it says nothing about whether a company is worth owning for years. The stack lane answers a different question: if Adam wants to own this and add to it over months, where are the sensible places to add, and did owning it beat just owning SPY.

It is built on the framework's HODL section and does not change any swing rule. That is why it is its own file and not a new framework version. Two buckets, kept separate: a name can be a swing NO and a stack name on the same day. ASTS was exactly that on 11/09 (B-1360).

## Who decides what

- **Adam** names the company, names the dollars per add, decides every add, and places every order.
- **The desk** gives the levels, states the honest answers to the HODL gate, and keeps score.
- **The script** records. It has no connection to any broker. `buy` writes down what Adam already bought.

This is his rules' output applied to live data, not investment advice.

## The lane

**Getting on.** Adam's order puts a name on. "Stack X", "put X on my stack lane" and "I want X on the stack" all mean: run the framework on it first (the row is required so the record shows what the desk thought that day), then `node scripts/stack.mjs add X --why "..." --by adam --row B-### --gate ...`.

**The HODL gate is answered and never refuses.** Four tests from the framework: durable business, real fundamentals, secular tailwind, survivability through a 40-50% drawdown. The answers sit beside the name so that Adam sees them every time he reads the lane. A failed gate is said once, plainly, at add time and when a print changes it. The framework's own line stays true: "A vertical chart on an unprofitable story stock is a trade you missed, not a hold." He may own it anyway. That is his call.

**Size.** Adam names it with `size`. The desk never invents one. With no size the levels print with no share count.

**Levels are mechanical, so nobody can argue with them after the fact.** Confirmed pivot lows (three bars each side), the 20-, 50- and 200-day averages, and the 52-week low. The first is at least 1 ATR under the price, each next one at least 1 ATR under the last, three at most. They refresh every night.

**Adding.** From the HODL section: accumulate, don't chase; never lump-sum into a spike; scale in tranches, adding on weakness and red days. `add` and `levels` print a SPIKE DAY flag when a name is up a full ATR on the day. It is a flag. A level being touched is a reason to look, never a signal to buy.

**Not here on purpose:** no 2:1 test, no 10% risk band, no trailing-the-market test, no price stop.

**Getting off.** Thesis invalidation, not a price stop. `--kill` records what would end the thesis in Adam's words. Size to survive, because there is no stop to save the position. With `--account N` the report shows each name's share of the account.

## Scoring

Every name is scored against SPY, because the only honest test of owning something is whether it beat owning the index.

- **A watch** (no buys yet) is scored in percent from the day it was added.
- **A held name** is scored against the same dollars put in SPY on the same days, tranche by tranche.

Scores are price return, with dividends not counted on either side. A split after a buy is carried onto that buy. Losers stay on the report as loud as winners. Survivors-only is how a stack lane lies.

## Commands

```
node scripts/stack.mjs add X --why "..." [--tranche-dollars N] [--by adam] [--row B-###] [--kill "..."] [--gate durable=x,fundamentals=x,tailwind=x,survivability=x]
node scripts/stack.mjs size X --tranche-dollars N
node scripts/stack.mjs buy X --shares N --price P [--date YYYY-MM-DD]
node scripts/stack.mjs levels X
node scripts/stack.mjs report [--account N]
node scripts/stack.mjs check --write
```

`bench-plan-check-close` runs `check --write` nightly. Registry: `db/stack.json`. Tests: `test/stack.test.mjs`.

## Boundaries

- Never a swing ticket. A stack level never becomes an entry-check row, and a swing NO never moves a stack level.
- Completely separate from the paper book and from Vans Thesis P-001.
- The phone gets a stack line only as part of a plan card. Nothing on this lane sends an order.

## The crowd log

Adam, the same day: "emotion plays a lot more in buys then you realize", and "we have to learn to record the fomo people are feeling and why they are buying". `scripts/crowd.mjs` records it beside this lane: a FOMO score out of 100 with every input shown, why people say they are buying, and what the stock did 1, 5, 10 and 20 sessions later against SPY. It runs nightly on stack names, the day's pump watches and the day's book names, and on demand with `capture --symbols X --note "..."` (a screenshot of an X post goes in as the note). Its headlines are a fact-check for the run. Its FOMO score and reasons are a record: a pattern in its report is a hypothesis for a forward test and never touches a verdict until Adam makes it a rule.
