# Hunt at the close — DRY RUN, Wed 9/16 06:25 CT (on Tuesday's closes)

This is the tool-approval run of the new routine, not the real one. It fired at 6:22 this morning, before the open and before today's 1:00 PM Fed decision. So everything below uses Tuesday 9/15's settled closes and Tuesday's closing option marks. I logged no book rows and no QR ids, so the 3:25 PM run starts clean. The saved hunt files are named 2026-09-15 and won't collide with today's.

The number: 57 names scanned, 1 READY, 27 STALK, 10 DISCOVERY. I pulled marks on 8 of them and only 1 spread fit your $304 band (10 percent of $3,046.11). Buying power is $62.41, so no ticket could be funded from the account anyway.

GRAB, short. It closed at 2.91, under its 50-day average, at a new 20-session low on 1.66 times normal volume, and it has lagged SPY by 17 points over 20 sessions. The spread would be the Sep 25 3.00/2.50 put spread at about $14.50 per contract, which is the most you can lose. Max gain is $35.50 and break-even is 2.85. The odds are the problem. Over GRAB's own history this setup moved down within 10 sessions 46 percent of the time, but it reached the 2.51 target only 2.5 percent of the time (79 cases, grade A, so the count is solid). The broker gives the long put a 41 percent chance of profit, a little below our 46. Expected value comes out negative, about minus $7 per contract. The catalyst is real: a $1.49B cash buy of Atome (the stock fell 3.6 percent on it), a Vietnam competition review, and the CEO sold $1.45M in August. There's no earnings report before expiry (next is 11/2). But there is a two-year floor at 2.90/2.85 just under the price, so the first stop is only 5 cents of room and a bounce is as likely as a break. Pre-market it's 2.95, back above the close. Verdict: NO. Already on the book as B-415 (pass).

Didn't fit the band on Tuesday's marks (the most you could lose on one spread): AMZN put spread $407, NVDA put spread $411, MSFT call spread $701, AVGO put spread $745, VRT put spread $914, AMD call spread $1,473, META call spread $1,614. The other 20 STALK names got no marks because of the 8-name cap: ETN, PWR, VST, WULF, NI, AMAT, DIS, QCOM, HIMS, MRNA, COHR, KEEL, AAOI, CEG, TLN, APLD, AIP, GEV, CRWV, SNDG. Some of the smaller ones (WULF, HIMS, KEEL, APLD, AIP) would likely fit the band.

A fix worth making before tonight: the routine gives the 8 marks slots to the highest readiness first. The Fed cap sets every name to 60, so the ties went to megacaps whose spreads can't fit $304. It should skip names whose spread width can't fit the band, and spend the slots on the cheaper names. Also, the VRT 175 put showed a fake mark of 0.795 (no bid, 1.59 ask, settled at 0.01), so I used the settled 0.01. It was over the band either way.

**Verdict:** NO
**Grade:** A on the count, but the count says the target almost never gets hit
**The number:** 2.5 percent odds of reaching 2.51 in 10 sessions; about minus $7 expected per spread
**Plan:** none; no spread, no shares
**Opens it:** a daily close under 2.85 (the floor breaks) on heavy volume, then re-run for the next floor
**Kills it:** a close back above 3.09
**Next date:** today's 3:25 PM real run, after the Fed
**Your call:** nothing to do
**Row:** B-415 (existing pass)
