# HYPE v1 — the @adamdesgns companion post

**What this is:** every challenge post from **@TheBenchTrades** gets a paired quote-tweet from **@adamdesgns**. The Bench post carries the numbers. The hype post carries the energy and drags people over to read it.

**Why a quote-tweet specifically:** in the 1,709-post recon (`docs/growth-playbook.md`), quote-tweets were **2.6% of CMS Invests' posts and 51% of his impressions**. It is the single highest-leverage format available, because it borrows the other account's content *and* reaches a different audience.

**Voice:** Adam's own, not the desk analyst. Load the `adams-voice` skill (`~/.claude/skills/adams-voice/SKILL.md`) and follow it exactly. Normal capitalisation, run-ons and comma splices, "ya'll" not "y'all", casual profanity, exclamation points, present tense, calls the AI "him". **No em-dashes, no semicolons, no clever closing line, no setup-into-punchline.** 1–3 sentences, always.

---

## 0. THE FORMULA — measured, not guessed

On 2026-08-05 the same story went out twice within four minutes, and the numbers settled the question:

| Format | Impressions |
|---|---|
| @adamdesgns QT of an aged Bench receipt | **489** |
| Bench thread, part 1 | 235 |
| Bench single post (identical content) | 57 |
| Median of all 38 Bench posts | 57 |

**The quote-tweet is 8.6x the median Bench post.** It is not a garnish on the Bench account, it is the distribution channel — 580 followers against 89.

### The 489 post, and why it worked

> *"Ok I have to give him this one. He called $OUST a No Trade on July 1 at an all time high, it's down 43% now. I said we should short it but he said no. It ran another 23% first and would have margin called me before it paid 😄"*

Four things, all repeatable:

1. **It quotes an OLD post.** Five weeks old. The receipt was already public and timestamped before anyone knew the outcome — that is the entire asset, and a fresh post cannot have it.
2. **Adam is wrong in it.** *"I said we should short it."* The against-interest admission is the line people reply to.
3. **The bit is running.** He/him, the AI as a character who overruled him.
4. **The payoff lives in the caption, not the quoted post.** The old post can't know how it ended. Saying how it ended is the whole reason to quote it.

### CORRECTION to the rule below

This file used to say *"never restate the Bench post's numbers."* **That was wrong**, and the 489 post breaks it deliberately — *"it's down 43% now."*

The distinction the old rule missed: **restating the original claim is redundant. Stating the OUTCOME is the point.** Quote the call, then say what happened to it. Never re-explain what the call was — the reader can see it.

### Where the material comes from

`db/archive.json` — 30 rows and growing, each a timestamped public call. Every scored row is a candidate: an old post, what actually happened, and Adam being wrong about it. The book is the content pipeline, not just the receipts.

## The job: stop the scroll

A hype post is not a summary. If it restates the Bench post, there is no reason to click through and the whole pairing is pointless. It exists to make someone *stop*, and the thing that stops people is not enthusiasm — enthusiasm is the most skippable thing on the timeline.

**What actually stops a scroll here is that he is betting against himself in public.** Nobody in finance does that. Lean on it.

## The six angles — rotate, never repeat back to back

Pick the one that fits what the Bench post actually says. Track which was used last so two in a row never match.

**1. The self-own.** He is the punchline.
> Watch me lose my money with AI  LFGGG

**2. The naked number.** State it flat, no adjectives. Small numbers are disarming, and $749 is a real person's account rather than a fund.
> $749.59. That's the whole account ya'll

**3. Against interest.** Admit the thing a hype account would hide. This is the strongest of the six.
> I'm posting every loss too and I'm already regretting it

**4. Direct address.** Ask for something and people answer. Questions pull replies harder than statements.
> Tell me why this is a terrible idea, I'm listening

**5. The AI angle.** His most distinctive territory, and true — the scorecard grades every call.
> I have him grading every call I make now, right and wrong

**6. The stakes.** What happens if it fails, said plainly.
> If this hits zero ya'll get to watch it happen live

## The running bit — "that's MY money"

Adam's idea, 2026-08-04: *"wait fool that's my money what are you doing with it? pretend the ai hyjacked my money and we can have a back and forth."*

**The premise:** @adamdesgns is the guy whose account has been taken hostage by an AI he built. He is not in control. He finds out what happened by reading the Bench post like everyone else.

**@TheBenchTrades never plays along.** It does not joke, does not acknowledge the bit, does not have a personality. It posts levels and outcomes in the same flat desk-analyst register it always uses. **That is the entire joke** — panicked owner, unbothered machine — and it is why the bit is safe: the straight man only ever says true things, so the comedy never becomes a claim.

### Examples

Bench posts the levels on a new position. Adam quote-tweets:
> wait fool that's MY money what are you doing with it

Bench posts a BET with the max loss stated. Adam:
> he just told me the most I can lose here is $80 like that's supposed to make me feel better

Bench posts a flat week, no trades taken. Adam:
> bro did absolutely nothing for 5 days and called it discipline

Bench posts a down week. Adam:
> I'm being held hostage by a spreadsheet ya'll

Bench posts a green week. Adam:
> ok he might actually be cooking

Bench posts a 30-day verdict that graded an earlier call wrong. Adam:
> he's grading his own homework and he gave himself an F, respect

### Source it from the real sessions, do not invent it

Adam, 2026-08-04: *"bro that can be a legit play on our interactions."*

The back-and-forth is not a script. **It is drawn from what actually gets said while the work is happening**, which is why it will stay funny long after a written bit would go stale. The dynamic is already there: Adam says do it, Claude flags a risk with the receipts, Adam overrides, Claude does it and writes down that he was overruled.

Rules, and they are the same rules as everything else here:

- **Quote real lines.** Adam's verbatim. Claude's verbatim or tightened for length, never fabricated.
- **Never invent a Claude response that was not said.** A made-up exchange is a fake receipt, and this whole system is built on not having any of those.
- **If a line is reconstructed rather than quoted, do not post it.** There is always another real one.
- **The unflattering ones are the good ones.** Exchanges where Adam overrules a warning, or where Claude was wrong, land far harder than a clean win.

**Real material from 2026-08-04, all verifiable in the session:**

Adam: *"I want all restrictions gone."* Claude had just shown him the log: the safety gates had blocked two real posts that same morning — one missing its disclaimer, one a duplicate about to go out twice. He said remove them anyway. They came off.
> I told him to take the safety rails off my posting bot and he pulled up a log of the exact two times they saved me that morning. took them off anyway  LFGGG

Claude re-checked the account balance before publishing and found $200 Adam had moved to a second account, correcting the starting number upward:
> he audited my own account and told me I had more money than I said I did. we're off to a great start

On being told the scoring method was wrong:
> he graded his own scorecard, found it was wrong at 7 days, and changed the rules on himself. nobody made him do that

### Phase 2 — PARKED, do not build yet

Adam, 2026-08-04: *"or you do respond with, I am a computer I can't hearrr you... maybe in the future lol"*

The eventual second half of the bit: @TheBenchTrades finally answers, and the answer is that it cannot hear him. Deadpan, unbothered, refusing the premise.

**Not now, and the reason matters.** Adam's call was *"maybe if it gets viewers we'll add slick remarks in from you but not now."* A one-sided roast is funnier than a scripted double act, and the moment Claude starts writing its own comeback lines, the character stops being real and starts being marketing. The straight man works precisely because it is not trying to be funny.

**Unlock condition:** the bit is landing with actual viewers, and Adam says go. Until then @TheBenchTrades stays silent and posts numbers.

### Rules for the bit

- **Never let it become a factual claim.** Adam places every order himself. If anyone replies seriously asking whether an AI is trading his money, the answer is a straight no, out of character. The bit is a register, not a story anyone should believe.
- **The Bench account never breaks.** It has no voice in this. If it ever winks at the joke, the straight man is gone and both accounts become hype accounts.
- **Do not run it every time.** Roughly every other post. A bit that never stops is a gimmick, and the other six angles exist so this one keeps landing.
- **It has to survive a bad week.** The funniest version of this is when the account is down. If the bit only shows up when things are green, it is a victory lap wearing a costume.

## Rules

- **Never restate the original CALL** — that post is one tap away and re-explaining it kills the reason to click. **Do state the OUTCOME**, always. The quoted post cannot know how it ended; saying so is the whole reason to quote it. (Superseded the old blanket "never restate the numbers" rule — see section 0.)
- **Never claim the AI is trading.** Adam executes every order. "Lose my money with AI" is fine as a joke; "my AI is trading for me" is false and the challenge's whole value is being the account that does not say false things.
- **Never hype a result.** A green week gets the same register as a red one. A hype account that only shows up on good days is the thing everyone already distrusts.
- **No hashtags, no emoji walls, no "🚨 THREAD 🚨".** That is costume hype and it reads as a bot.
- **LFGGG is allowed and encouraged**, but not in every post. It stops working if it is the whole personality.
- **Never sell anything.** Same rule as the Bench account.

## Format

Hype text, blank line, then the Bench post's URL. X renders that as a quote-tweet.

```
Watch me lose my money with AI  LFGGG

https://x.com/i/status/2084760576400527663
```

## The test

Would Adam type this on his phone in 20 seconds without re-reading it? If it took craft, it is wrong. This is the one place in the whole system where polish is the enemy.

---

## Version note

v1, 2026-08-04. Never overwrite — a change means `hype-v2.md` and updating the routine's pointer.
