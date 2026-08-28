# Overnight run — the watchlist, Sunday 2026-08-23

**Pulled 19:49 CT (2026-08-24T00:49Z)** via Robinhood MCP `get_equity_quotes`.
Framework: `prompts/trading-copilot-v25.md`. 38 names — the 23-name board plus
the live watchlist.

**Read this caveat first.** The regular session has been shut since Friday
2026-08-21 15:00 CT. Everything below is the **24/5 overnight tape**, whose
volume is a fraction of regular hours. These prints are indicative, not
confirmed — a thin-tape move reverts at the open often enough that none of it
is tradeable on its own. Change is measured against Friday's settled close.
NI, VNET, AAP and ASPI had no fresh overnight print and are left out rather
than shown at a stale price.

**14 up, 21 down, 3 flat.**

---

## The one real divergence: money is concentrating into Nvidia and leaving the rest of silicon

| | Overnight | vs Fri close |
|---|---|---|
| **NVDA** | 216.50 | **+0.83%** |
| MRVL | 234.90 | −0.90% |
| MU | 958.98 | −0.81% |
| SMCI | 37.03 | −0.56% |
| DELL | 439.98 | −0.48% |
| AMD | 471.04 | −0.47% |
| AMAT | 489.99 | −0.47% |
| AVGO | 368.49 | +0.01% |

Nvidia is the only name in the silicon complex bid tonight, and it is bid three
days before its own print. Every other name that sells into the same buildout
is offered. That is not a sector move — it is a rotation *inside* the sector,
into the one name with a Wednesday catalyst.

**Marvell continues.** It closed −5.56% Friday and is another −0.90% tonight,
so the selling did not stop at the bell. It reports Thursday. B-186 passed it
on size and skew and that pass is unchanged by this — if anything the overnight
tape says the market is still leaving.

**The leverage lane demonstrates itself.** MU −0.81% and MUU −1.62% is almost
exactly 2x, which is the daily-reset product doing what v25 says it does on a
single day. It is the multi-day path where the decay lives, not here.

## The power layer is not following silicon down

WULF **+1.34%**, VST +0.57%, CEG +0.14%, CORZ +0.22%, TLN flat — against VRT
−0.65% and APLD −0.18%. Mixed, but the electricity names are holding while the
chips sell off. Consistent with the standing beat thesis that the layers move
apart, and worth watching if it survives into the regular session.

## MRNA is the largest move on the board and we have no explanation for it

**145.13 → 149.30, +2.87%**, the biggest mover in the whole 38-name pull by more
than double. It is on the watchlist as WATCH with no live trigger, and there is
no catalyst on `db/catalysts.json` for it. **No thesis is offered here** — an
unexplained 2.87% on overnight liquidity is a question, not a signal. It is
flagged for a proper look at the open, and the honest position is that we do
not know why.

## The position: ZYME

**29.00 overnight, +1.15%**, against a 27.16 basis — up roughly $27 on 15 shares.
The bid/ask is **28.63 × 29.56**, which is nearly a dollar wide and is what
thin overnight liquidity looks like on a small biotech.

B-175's first-supply level is **29.75** and it is now within 75 cents of it,
before the FDA has ruled. Some of the approval is being priced ahead of the
decision. The decision on trimming has to be made Monday because Tuesday is
the event — **decide_by 2026-08-25**, invalidation 23.98.

Nothing about the stop position changes: 15 shares cannot be hedged with
100-share option blocks, ZYME's nearest expiry is 2026-09-18 with no weeklies,
and a stop order fills at the gap rather than at the level. The size is the
risk control.

## Everything else: nothing actionable

No watchlist trigger fired. The two ARMED names are quiet — NKE 40.75 (−0.02%)
and VICI 26.64 (+0.49%). The HOT-ACCUMULATE pair are both slightly offered,
SPCX −0.73% and HIMS −0.33%. GDS and PLAB did not trade overnight at all.

## What this changes for the week

**Nothing on Monday.** No board name reports, no macro, and no trigger is live.
Monday is a positioning day and the only decision on it is the ZYME trim.

The overnight tape does sharpen Wednesday: if Nvidia is being bought ahead of
the print while everything around it is sold, then the guide has more riding on
it than usual — a soft guide disappoints a crowd that has already positioned,
and P-006 is four instances deep on exactly that shape.

---

*No call was made in this run and no book row was written, because nothing
crossed a gate. Prices must be re-pulled before any action — an overnight print
is not an entry price.*
