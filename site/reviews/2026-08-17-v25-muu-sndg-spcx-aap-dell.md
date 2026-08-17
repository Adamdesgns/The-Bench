# v25 LAUNCH + FIVE RUNS — 2026-08-17 (Monday), post-close

**Framework: v25** (`prompts/trading-copilot-v25.md`, written today). Runs below: **AAP · DELL · GDS · MUU · SNDG · SPCX**, plus the HPQ close.
Companion file: `2026-08-17-queue-check.md` covers the HPQ stop fill from the morning session.

---

## THE TAPE — the market sorted memory sellers from memory buyers, and paid the sellers

**SPY 772.68 (−0.47%) · QQQ 729.86 (−0.17%) · SMH 593.98 (+1.05%)**

| Sells memory | | Buys memory | |
|---|---|---|---|
| **SNDG** (2x SNDK) | **+17.71%** | SMCI | −3.93% |
| **SNDK** | **+8.91%** | HPQ | −2.34% |
| **MUU** (2x MU) | **+8.06%** | DELL | −2.27% |
| COHR | +7.70% | | |
| AMAT | +5.56% | | |
| WDC | +5.35% | | |
| MU | +4.16% | | |

One catalyst, two opposite reactions: **Lenovo warned the memory shortage runs all year with contract prices possibly doubling.** HP's CFO had already put memory at **35% of a PC's bill of materials versus 15–18% historically.** Shortage is pricing power for the maker and margin compression for the assembler.

Defensives bled: **NKE −4.05% to a new low**, MCD −2.67%, PEP −1.80%, VICI −1.50%.

---

## WHAT SHIPPED: v25

Three changes, one of them earned by a loss on this book.

**1. THE ATR FLOOR.** No stop may sit closer than **1.0 ATR(14)** from entry — *including after a ratchet*, which is where v24 had the hole. Earned by HPQ (B-113): the stop was ratcheted to 29.30 on 8/13, **$0.155 above a 29.145 cost against an ATR of $1.374 — 0.11 ATR**, roughly a tenth of one day's range. It was taken by noise four days later, twelve minutes after the open, on a day low of **29.14** against a **29.145** basis. The original 27.65 stop was 1.09 ATR and correctly calibrated. v24 said stops move only in the trade's favour but never said *how close is too close*.

**2. THE LEVERAGE LANE.** Daily-reset 2x/3x ETFs are permitted — often the only affordable expression of a validated thesis on a small account. With one premise corrected, because it is arithmetic and not risk tolerance: **on a daily-reset product you can be directionally right and still lose.**

**The live proof, same-window, verified:**

| From 7/13 close | To 8/17 | Move |
|---|---|---|
| MU | $937.00 → $1,012.08 | **+8.01%** |
| MUU (2x) | $33.91 → $35.00 | **+3.21%** |

A clean 2x is +16.0%. MUU delivered +3.2% — **40% of the underlying's move while levered 2x.** MU dipped −21% to $739 and recovered; MUU dipped **−42%** to $19.63, and climbing out of −42% takes +81% where −21% takes +27%.

**3. THE CONCENTRATION DECLARATION.** All-in single-name positions are permitted and must be **declared and tagged**, because at 100% of the account the position-sizing formula stops functioning — position size becomes an input, not an output, and the stop is the only remaining risk control. Scored separately, so the book can answer later whether concentration actually paid.

---

## THE RUNS

### HPQ — Stopped, closed (B-113)
Stop filled **8:42:39am CT at 29.29**, twelve minutes after the open. Cost 29.145, realized **+$2.175**, zero fees. B-090 had predicted *"worst case ~+$2.30 before slippage"* — right to the penny. The day low was **29.14**, a half-cent under the cost basis; it closed **29.405**, back above the stop.

**P-008's fourth instance.** B-077 flagged on 8/13 at 31.32 that Lenovo's blowout quarter carried bad forward commentary while the market bought the beat. Four days later HPQ was −9.5% off its 32.19 high. The print was good; the guide was bad; the reaction followed the guide.

Re-armed as a **scorable pass (B-122)** rather than dropped — so `score-book.js` flags it WRONG as an *expensive pass* if it runs without us. Post-print check scheduled 8/27.

### DELL — No Trade, both directions (B-119)
Raised as the put candidate on the memory-squeeze thesis, then **killed by its own gates.** Gate 1 fails: DELL beat by **66%** last quarter *with* memory costs already rising, has pushed 15–20% price increases, and its ISG segment sells AI servers into the same buildout causing the shortage — the cost pressure and the demand tailwind are the same event. Gate 2 fails decisively: the 52-week high was set **four days ago**, RSI 61.8, volume below pace. And the Sep-18 460 put asks **$3,410 against a $1,020 account** — 3.3x the account, at 78.85% IV into a verified 9/3 print.

### GDS — Conditional, trigger corrected twice (B-117 → B-120)
The logged 33.50–34.80 zone clears both the 2:1 floor and a 1-ATR stop **only between 34.37 and 34.42** — a five-cent window. Trigger set **34.40**, 16 shares, stop **32.70** (the earnings-day low), risk $27.20, 2.03:1 to T1 37.85.

**The 8/13 "61% EPS miss" was an artifact.** Net income swung to **RMB 837.6M from a RMB 70.6M loss**, revenue *and* EBITDA guidance were raised, and the **FY26 bookings target doubled to 1 gigawatt from 500MW.** Miss on the print, raise on the guide — the SMCI mirror. The tape agreed: 8/13 closed **+6.20% on 3.2x volume.**

Closed **35.37**, above the trigger. Unbought, unchased.

### AAP — Conditional, post-print only (B-118)
Q2 prints **8/20 am, verified.** Entry post-print, limit **≤54.50**, stop 51.90, 7 shares, risk $18.20 — **and only if the guide is held or raised.** The geometry is why: ATR 2.728 (4.85%) with no trend means buying at 56.30 forces a choice between a 0.73-ATR stop and a 1.5:1 payoff. AAP is the relative-strength leader of auto-parts retail — **−13.7% off its high versus ORLY −16.6% and AZO −30.4%** — and has beaten five straight, the last two by +79% and +105%. But P-006 says beat-and-fall is the *modal* outcome in retail. The beat streak is not the thesis; the guide is.

### MUU — Conditional (B-121)
2x daily Micron. Entry preferred on a pullback toward **33.93**, stop **30.00** (1.14 ATR), 6 shares, risk $33.06, T1 46.53. **Hard dated exit 9/21**, before MU's 9/22 print.

Micron's fundamentals are the strongest on the board: **six straight beats, EPS $1.56 → $25.11 in five quarters**, next estimate $31.27 — and the thesis is confirmed by its own victims. Closed **35.00**, above the trigger.

### SNDG — Watchlist only, armed (no row yet)
2x daily SanDisk. **ATR 18.24% of price** — the highest on the board. Decay is worse than MUU's: SNDK and SNDG both peaked 6/22; SNDK is −24.2%, a clean 2x is −48.4%, **SNDG is −61.6%** — a 13.2-point gap.

And the entry is the worst available: **8/13 +27.2%, 8/14 +15.2%, 8/17 +17.7% — up 72% in three sessions.** Its one real edge over MUU is the calendar: SanDisk reported 8/5 and doesn't print again until **11/05, outside any window.** Armed below ~10.00, stop 9.20.

*(SNDC rejected: $6.1M market cap, 610K shares outstanding — too small to be in the conversation.)*

### SPCX — No Trade, but the gate that failed six rows is closed (B-123)
Every prior SPCX row died on the same sentence: *"never carried a fundamental grade."* It reported **Q2 on 8/4, its first quarter public**, so the numbers exist: revenue **$7.8B +92%**, adj. EBITDA **$3.538B +191%**, **Starlink $4.3B +66% with 12M subscribers doubled and $1.66B of segment operating profit** — the only profitable segment. Net loss −$541M. **CapEx $18.4B in the quarter** versus $10.1B prior. $100B cash, $47.5B backlog.

**FUNDAMENTAL GRADE: B.** Accumulation is now **2 of 3** — gate 1 passes for the first time, gate 3 passes (20 EMA 130.28 = 1.56 ATR below), **gate 2 fails**: 146.28 is the top of the entire logged range and +39.5% off the low in ten sessions.

The supply calendar still governs: float is **12.0% of shares outstanding**, expanding **~6x in late September**, ~1/3 public by 10/31, 180-day lockup 12/8. A 2–8 week window contains that expansion.

**HODL now qualifies on the merits.** Accumulate on weakness only — never the top of the range.

---

## WHAT ACTUALLY HAPPENED TODAY

**Nothing was bought.** Every leveraged name closed too hot to enter — MUU +8.1%, SNDG +17.7%, SPCX rejected at its high on 73% of average volume. GDS and MUU both closed **above** their armed triggers, so neither filled.

That is the day's result: six names run, five armed, zero chased.

*Proof, not hype. @TheBenchTrades. Not financial advice. Educational only.*
