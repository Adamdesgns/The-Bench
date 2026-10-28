# Benny on an X Space, talking like KEORIS: design proposal (2026-10-25)

**Status:** design only. Nothing built, nothing installed, no X login, nothing posted.
**Asked by Adam, 2026-10-25:** *"could we have an x live with benny and him talk like keoris does?"*
**Short answer:** yes, as a **co-host voice on a Space that Adam hosts from his own account on this PC**.
X has no API that lets a program speak in a Space, so Benny can't join on his own. Adam hosts from
x.com in a browser, and Benny's voice goes into that browser through a virtual microphone. Benny uses
KEORIS's voice engine (Kokoro, voice `bm_daniel`) and the same answer pipeline as #ask-benny. **Adam
approves every answer before it is spoken.**

---

## 1. What X allows today

| Question | Answer | Source |
|---|---|---|
| Can the X API create, host or speak in a Space? | **No.** The Spaces API has five endpoints, all lookups: by ID, by several IDs, by creator, ticket buyers, and keyword search. Nothing starts a Space, joins as a speaker or sends audio. | [X API: Spaces introduction](https://docs.x.com/x-api/spaces/introduction.md) |
| Can a Space be hosted from a PC? | **Probably yes, from x.com in a browser.** A July 2026 report says X's rebuilt Android app lost hosting and X's head of product pointed people to the web version: sidebar, then **Create a Space**. X's own help pages still say "iOS and Android", so they look out of date. **Not verified on Adam's account** (see step 0). | [roboin.io, 2026-07-20](https://roboin.io/article/en/2026/07/20/unable-to-create-an-x-space-on-android/), [X help: hosting](https://help.x.com/en/using-x/spaces-hosting) |
| Can a program stream into an X **Live** (video)? | **Yes, over RTMP** (a standard streaming protocol that OBS speaks) through Media Studio Producer, which X is replacing with "Live Studio" (third-party report, July 2026). Access may need X Premium. Not checked on Adam's account. | [X help: Media Studio Producer](https://help.x.com/en/using-x/how-to-use-live-producer), [quasa.io on Live Studio](https://quasa.io/media/x-launches-live-studio-to-simplify-livestream-broadcasting) |
| What do X's automation rules say? | Automated accounts must carry the **"Automated" label**, say they're a bot and who runs them in the bio, and stay linked to a human-run account. Write actions done by a program (posting, following, DMs) fall under the Automation Rules. The full rules page (help.x.com/en/rules-and-policies/x-automation) returned 403 to every reader tried today, so this comes from X's label page and developer guidelines. | [X help: automated account labels](https://help.x.com/en/using-x/automated-account-labels), [X developer guidelines](https://docs.x.com/developer-guidelines), [X developer policy](https://docs.x.com/developer-terms/policy) |

**What that means for this design.** Nothing here uses the X API, and no program logs in, posts,
follows, DMs or clicks on X. Adam opens the Space, Adam picks who speaks, and Adam presses the key
that plays each answer. A human-run Space where the host plays an AI voice is not "API automation"
as X defines it. Still, X has no rule that clearly covers it either way, so **disclose it every time**:
"AI co-host" in the Space title, and Adam says it out loud at the start. A separate "Benny" X account
is **not recommended**. It would need the Automated label and a link to Adam's account, and it gains
nothing, because a second account can't speak in a Space without a phone or browser of its own.

**Live (video) or Space (audio)?** Start with a **Space**: it's free and audio-only, and Benny is a
voice. An X Live through OBS could add Benny's orb and the on-screen numbers later. It uses the same
audio path plus OBS, but Premium may gate it and it's more setup. That's phase 3, not phase 1.

---

## 2. KEORIS's voice: what it is and whether Benny can reuse it

Read from `keoris-local-assistant` branch `rebrand/keoris` (head `0dc2899`, 2026-10-19), without
switching that checkout's branch.

| Part | What KEORIS uses | Where | Free? |
|---|---|---|---|
| **Hearing (speech to text)** | **faster-whisper `small.en`**, run by a Python service; wake word through openwakeword (`hey_keoris.onnx`); "hint words" fix the names it mishears | `core/local-voice-service.js`, `scripts/local_voice.py`, `scripts/local-voice-requirements.txt` | Yes, MIT, local. Already installed on this PC |
| **Speaking (text to speech)** | **Kokoro-82M** through `kokoro-js` ^1.2.1, **fp32 on WebGPU** in a hidden Electron window (RTF 0.15 on the RTX 5060, meaning 10 s of speech renders in about 1.5 s) | `core/voice-service.js`, `src/voice-worker.js`, spec `docs/superpowers/specs/2026-07-26-kokoro-voice-design.md` | Yes, Apache-2.0. Model already downloaded to `%LOCALAPPDATA%\jarvis-kokoro` |
| **The voice** | **`bm_daniel`**, a British male Adam picked by ear from an eight-voice audition (`core/defaults.js`) | | |
| **Spoken style** | Answer first, short, "spoken-plain"; `speakableText()` strips markdown before speaking ("spoken asterisks are the fastest way to make a good voice sound broken") | `core/voice-service.js`, `core/ai-service.js` | |

**Hard-won lessons in the KEORIS spec that Benny's voice must keep:**
1. **fp16 and q4f16 make silent files on this GPU.** They're the right length and report no error,
   but contain no sound. Use fp32 only.
2. **Check every clip's loudness before it plays.** Reject any clip with NaN, peak ≤ 0.05 or RMS ≤ 0.005.
   On a live Space, a silent answer is dead air while the host thinks the bot is talking.
3. **WebGPU only works in an Electron or browser window**, not plain Node. Node on the CPU ran at
   RTF 2.11, slower than real time, so a script-only Benny would stutter. Set `force_high_performance_gpu`
   too, or Chromium picks the Intel chip (RTF 0.50).
4. **Warm the model up before going live.** The first clip took 4.1 s cold and 0.7 s warm.

**The licence flag doesn't apply here.** The KEORIS spec flags `phonemizer` (espeak-ng, GPLv3) as a
risk for a product that is **sold**. Benny is private and nothing is distributed, so it doesn't matter
for this use.

**Two ways to reuse it:**
- **(A) Quick test: ask KEORIS to say it.** KEORIS's phone server already has `POST /api/tts`, which
  returns a WAV from the warm model. It needs a paired device (`/api/pair` with a code from KEORIS
  Settings). Benny's booth could pair once and use it. It only works while KEORIS is running, and it
  ties Benny to a product that is meant to be sold.
- **(B) Recommended: a small `benny-voice` Electron helper** that copies KEORIS's voice-worker pattern
  (hidden window, fp32 WebGPU, warm-up, loudness check, `speakableText`) and plays to a chosen audio
  device with `setSinkId`. That's about 150 lines adapted from code Adam already owns, and Benny no
  longer needs KEORIS open.

**Same voice as KEORIS, or not?** "Talk like KEORIS" could mean the same voice, or the same quality
and style in a voice of his own. If Benny uses `bm_daniel`, people who hear the Space are hearing
KEORIS's voice give market numbers. That's worth deciding before the product launches (open question 2).

---

## 3. The loop

```
 question in ──► screen ──► Benny's answer pipeline ──► Adam approves ──► voice ──► virtual mic ──► x.com Space
 (text, or a     (topic,    (same locked-down Opus     (booth page:      (Kokoro    (VoiceMeeter
  transcribed    caps,       session, wall check,      Speak / Skip /     bm_daniel, AUX → browser
  speaker v2)    HALT)       internals, secrets,       Edit-to-shorter)   loudness    mic input)
                             sign-off)                                    checked)
```

### 3.1 Where the questions come from (screening)

**v1: no listener audio at all.** Questions come in as **text** from three places: the replies under
the Space's own post, #ask-benny on Discord (the existing listener), or Adam typing or saying one
himself. Adam controls the Space's speaker list like any host. This removes the riskiest part (a
stranger's live audio going into a model) and costs no speech-to-text.

**v2: transcribe an invited speaker, on Adam's hotkey.** Adam presses a key, the booth records the
browser's **output** (what the Space sounds like) until he presses it again, and faster-whisper
`small.en` turns it into text with hint words (tickers on the board, "Benny", "The Bench"). The text
lands in the queue like any typed question. **It is never sent automatically.** Adam reads the
transcript before anything else happens.

**Every question, from any source, passes the same gates before Opus runs:**
- **HALT** (`benny/HALT`) stops everything (below).
- **A per-Space cap:** a new `space_answer_cap`, suggested 25, so a busy room can't run the bill up.
- **A cheap local pre-screen (optional, free):** Qwen3.5 via Ollama, already rated in Free First as a
  yes/no decision model (~1.3 s). It drops spam, abuse and off-topic questions before an Opus call
  costs money. It only filters. It never answers.
- **Guest rules**, not operator rules: every Space question is treated as a guest's, including ones
  Adam passes along. The existing `TOPIC_RULES` and `DATA_RULES` apply, so Benny never says "buy",
  never gives balances or positions, and never describes how he's built.

### 3.2 The answer: same pipeline, plus a spoken mode

The booth calls the **same** `answer()` path `benny/listener.mjs` uses: `buildClaudeArgs` (Opus,
`--strict-mcp-config`, four read-only Robinhood quote tools plus WebSearch, `dontAsk`), `checkTools`
on the session's own init message, `topicGate`, `checkWall`, `secretLeaks`, `internalsLeaks`,
`composeAnswer` (sign-off). The only new piece is a **`SPOKEN_RULES`** block added after
`VOICE_RULES` for this channel:
- At most about 70 words (about 25 seconds spoken). The answer goes in the first sentence.
- No links, bullets, tables or emoji. Sources are named in words ("per Reuters this morning").
- Tickers spoken the way traders say them (company name, or "N-V-D-A"), prices as words a voice
  reads cleanly ("one eighty-two fifty"). Do this in a pure `speakForBenny()` function with tests,
  not with the model, so it can't drift.
- The sign-off is **spoken** after each answer: "Paper trades only. Not financial advice. Educational
  only." It's about 4 seconds. The wall check runs on the exact text that gets spoken, sign-off included.

Every answer is logged to `db/benny-qa.json` with `channel: "x-space"` and the Space ID, so each one
has a record, the same as Discord.

### 3.3 How Adam stays in control

| Control | How it works |
|---|---|
| **Approve each answer** (default, always on in v1) | The booth (a local page on `127.0.0.1`) shows the question, Benny's draft, the wall result and the cost. Benny speaks only when Adam presses **Speak**. **Skip** drops it. **Shorter** reruns with "half the length". |
| **Push-to-talk for Adam** | VoiceMeeter's mute buttons, or a hotkey: Adam's real mic and Benny's channel are separate faders into the one virtual mic. |
| **Stop mid-sentence** | One hotkey stops playback at once and clears the queue. |
| **Kill switch** | The booth checks the **same `benny/HALT` file** before every answer and before every clip plays. `!halt` in Discord or the booth's HALT button stops both channels. Last resort: mute Benny's fader. |
| **No answer without a person** | No auto-speak mode in v1 or v2. Turning one on later would be Adam's decision and a design change of its own. |

### 3.4 Expected delay and cost

| Step | Time | Basis |
|---|---|---|
| Speech to text (v2 only) | ~1–2 s for a 15 s question | faster-whisper small.en, warm, on this PC. Estimate. |
| Pre-screen (optional) | ~1.3 s | Free First entry, measured 2026-09-23 |
| **Opus answer** | **~15–45 s, not measured** | `claude -p` start-up, MCP connection, a quote pull, sometimes a web search. The Q&A log has no timing field; **build step 1 measures it.** |
| Adam reads and approves | ~5–10 s | |
| Kokoro voice | first sentence in <1 s, the rest streams | RTF 0.15 on WebGPU fp32 (KEORIS spec) |
| **Question to first word** | **~25–60 s** | Adam talks over the gap ("let's see what Benny pulls"). That's normal for a call-in show. |

**Cost per answer (Opus):** from the 17 answers in `db/benny-qa.json` that carry `cost_usd`,
median **$0.10**, 90th percentile **$0.23**, max **$0.41**. That's the API-price figure the CLI
reports. On Adam's Claude plan it uses plan allowance rather than a bill. **A one-hour Space with 20
answers is about $2–5 at API prices.** Speech-to-text, voice and audio routing cost $0. Sonnet would
cut the time and cost roughly in half, but Adam moved Benny to Opus on 2026-10-25 for answer quality,
so this keeps Opus (open question 5).

---

## 4. Which account, and the risks of a live finance voice

**It runs from Adam's own account (@adamdesgns), with Adam present as host.** The Bench's public
account was banned 2026-09-02 and The Bench is private now (`CLAUDE.md`), so this design doesn't
bring back @TheBenchTrades or any public Bench channel. A Space is public speech on Adam's main
account, so **a mistake costs that account, not a throwaway.** The settings below are tuned for that.

**Risks, and how the design handles each:**
1. **"Not financial advice" isn't a shield on its own.** A voice answering a stranger's question about
   *their* trade, live, sounds a lot like personal advice. Handling: guest rules only, "the data, not the
   call" (`DATA_RULES`), never "buy" or "sell", no position sizing for the asker, a spoken sign-off on
   every answer, a disclaimer in the Space title, and Adam's approval on each answer.
2. **Promotion and pump risk.** A live room naming tickers to listeners is exactly the setting the SEC
   went after in its December 2022 case against eight social-media stock promoters, who used Twitter and
   Discord to pump and dump (*SEC v. Constantinescu et al.*). Handling: **no small caps or tickers under
   $5 on air** unless a listener asks first; **Adam says out loud whether he holds** any ticker Benny
   discusses (Benny can't see his positions and must not); no price targets framed as predictions
   unless the prediction is already a logged row (B-### or prediction ID) with its scoring test, per the
   "log and watch every prediction" rule; no paid or sponsored mentions, ever.
3. **Something Benny makes up, said live.** Text on Discord can be deleted; a Space recording can't.
   Handling: Adam reads every draft first, the wall and internals checks run on the spoken text, and
   any price comes from the quote tools with its time stamped ("as of 2:14 Central").
4. **An AI voice that people might take for a person.** Handling: "AI co-host" in the title, said out
   loud at the start and again whenever someone new is brought up to speak.
5. **The account's history.** We don't know the exact reason for the 2026-09-02 ban (not in the repo).
   If it was automation or spam, a new AI-voiced finance show on Adam's main account deserves extra care
   (open question 1).
6. **Recording.** If Adam records the Space, X keeps it. Benny's answers then sit on Adam's account as
   long as X keeps them. The Q&A log has every answer for review.

---

## 5. Free-first tool list

Checked against `Projects\resources\free-first\INDEX.md` on 2026-10-25. The index has **no speech or
virtual-audio entries yet**, so items marked "not in index" should be added there after a real test.

| Need | Tool | Cost / licence | Status here |
|---|---|---|---|
| Voice | Kokoro-82M via `kokoro-js` (fp32, WebGPU) | Free, Apache-2.0 (phonemizer GPL, see §2) | On this PC, used by KEORIS. Not in index |
| Hearing (v2) | faster-whisper `small.en` | Free, MIT | On this PC, used by KEORIS. Not in index |
| Answer brain | Claude Opus via `claude -p` | Adam's Claude plan (~$0.10/answer at API price) | In use by Benny |
| Pre-screen (optional) | Qwen3.5 via Ollama | Free, local | **In index, Tested 2026-09-23** |
| Virtual mic and mixer | **VB-Audio VoiceMeeter** (Banana) | Donationware, free for personal use | **Not installed** (this PC has only Realtek, Intel and NVIDIA audio devices). Not in index. Adam installs it (download needs his OK) |
| Simpler virtual mic (if Adam won't talk on the same Space feed) | VB-Audio VB-CABLE | Donationware | Not installed. Not in index |
| Desktop host | x.com in Chrome or Edge | Free | Hosting not yet confirmed on Adam's account |
| X Live video (phase 3 only) | OBS Studio + RTMP to Live Studio / Producer | OBS free (GPL). X side may need Premium | Not in index (FFmpeg is, under Media) |
| Booth page and helper | Node + Electron | Free | Already used across Adam's apps |

Nothing here needs paying for. The only possible spend is X Premium, and only for the phase-3 video version.

---

## 6. Build plan

Each step is small and ends with something Adam can check. **Nothing goes on a real Space until step 6.**

0. **Adam checks hosting (1 minute, Adam only).** On x.com in Chrome on this PC, see whether the left
   sidebar shows **Create a Space**. If it doesn't, the plan becomes: Adam hosts on his phone, and the
   PC joins as a co-host or speaker through the browser (speaking from desktop is confirmed), with
   Benny's audio going into that browser.
1. **Spoken answer mode (code, tested).** Add `SPOKEN_RULES` and a pure `speakForBenny(text, board)`
   (tickers, prices, times into words; links and markdown removed) to `benny/ask.mjs`, with tests in
   `test/`. Add `duration_ms` to every answer logged in `db/benny-qa.json` so latency gets measured, not
   guessed. Done when: 20 sample answers come out under 70 words, the wall passes, and a median latency
   is on record.
2. **`benny-voice` helper (code).** An Electron helper in `benny/voice/` adapted from KEORIS's
   `voice-worker`: Kokoro fp32 on WebGPU, `force_high_performance_gpu`, warm-up clip, loudness check,
   and an output-device picker. Done when: it renders a 30-second answer to a WAV in under 5 s, and the
   loudness check rejects a deliberately silent clip. (Option A, KEORIS's `/api/tts`, can stand in for a
   first listen while this gets built.)
3. **The booth (code).** A local page on `127.0.0.1` with the question queue (typed, Discord, Space
   replies pasted in), draft, wall result, cost, **Speak / Skip / Shorter / Stop / HALT**, a per-Space
   cap, and the HALT file check before every answer and every clip. Done when: a typed question goes
   from queue to approved draft to Benny's voice on the PC speakers.
4. **Audio routing (Adam installs, Claude writes the settings sheet).** Install VoiceMeeter Banana.
   Adam's mic goes on hardware input 1 and `benny-voice` on the AUX virtual input. The browser's mic is
   VoiceMeeter's output. Done when: Windows' mic test shows both Adam and Benny on one input.
5. **Dress rehearsal (offline).** Record the booth's own output to a WAV for 10 minutes: Adam asks 10
   questions, Benny answers 10. Adam listens on his phone. Done when: Adam likes the voice, the pace and
   the sign-off.
6. **First real Space (Adam's go).** Short and announced: "AI co-host test, 20 minutes", text questions
   only, cap 10. Afterwards, review every logged answer and write up what went wrong.
7. **v2: speaker questions by voice.** The hotkey records the browser's output, faster-whisper
   `small.en` transcribes it with board hint words, and the text goes into the queue. Adam still approves
   each one.
8. **Phase 3 (optional): X Live video.** OBS with a browser source of Benny's orb and the numbers on
   screen, plus the same audio, sent over RTMP. Only if the Space works and Adam wants video.

Every step that adds code also gets the vault ritual: Daily bullets, a Dev Log line, and an Open Loops row while it's unfinished.

---

## 7. Open questions for Adam

1. **Your own account, OK?** This runs from @adamdesgns with you hosting. Since the Bench account was
   banned 2026-09-02, do you know why? If it was automation or spam, we go slower on your main account.
2. **Same voice as KEORIS (`bm_daniel`), or his own?** Same voice means listeners hear KEORIS giving
   market numbers before KEORIS launches. A different Kokoro voice (e.g. `am_michael`, American, graded
   C+) keeps the brands apart.
3. **Approve every answer: keep it that way for good?** The design has no auto-speak mode. Fine?
4. **Questions by text only for the first Spaces?** Recommended. Speaker questions by voice come in v2.
5. **Opus, even at 25–60 s to the first word?** Or Sonnet for the Space only, to roughly halve the wait?
6. **Can you see "Create a Space" on x.com on this PC?** (Step 0.)

---

*Sources checked 2026-10-25: X API Spaces docs, X help (automated account labels, hosting, Media
Studio Producer), X developer guidelines and policy, roboin.io (desktop hosting, 2026-07-20), quasa.io
(Live Studio). The X automation-rules page itself returned 403 to every reader tried. KEORIS facts read
from `rebrand/keoris` at `0dc2899`. Cost figures from `db/benny-qa.json` (17 answers with a cost
field).*
