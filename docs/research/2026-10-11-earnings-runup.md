# When do stocks start pricing in earnings? (2026-10-11)

Adam: *"How much time do we need to make plans? a month 2 months. Look into earnings plays with data and see when they most commonly start getting priced in."*

**Script:** `scripts/earnings-runup.mjs`. **Full output:** `docs/research/2026-10-11-earnings-runup.json`.
**Sample:** 12,405 earnings reports across 426 of the 460 base-rate names, Oct 2017 to Sep 2026. Report dates come from SEC 8-K Item 2.02 filings, timestamped, so before-open and after-close reports are separated. Prices are Yahoo adjusted daily closes. Each day's move is measured against what that stock normally does relative to SPY (market model with alpha and beta, estimated 250 to 70 sessions before the report). Significance is clustered by calendar quarter, because earnings seasons put hundreds of names on the same weeks.
34 names had no 8-K earnings filings (foreign filers such as TSM, BABA and NIO file 6-Ks) and were skipped.

## The answer: on average, earnings are not priced in ahead of time

| Buy at close of day −N, sell at close of day −1 (before the print) | mean | median | win % | t |
|---|---|---|---|---|
| 60 sessions | +0.46% | −0.09% | 49.7 | 0.36 |
| 40 | −0.12% | −0.43% | 48.7 | −0.17 |
| 30 | +0.07% | −0.16% | 49.4 | 0.01 |
| 20 | +0.23% | −0.04% | 49.8 | 0.35 |
| 10 | +0.23% | +0.03% | 50.3 | 0.87 |
| 5 | +0.19% | +0.08% | 50.9 | 1.28 |

There's no window where running into the print reliably works. Every holding period is a coin flip, and the medians sit at zero. It also flips sign from year to year: positive in 2020, 2022 and 2024, negative in 2018, 2021, 2025 and 2026. No size band or sector reaches significance.

**A trap we caught on the way.** The first test on 15 mega-caps showed a clean +2% run-up starting 60 days out. Nearly all of it was survivorship: today's universe is made of past winners, which beat SPY every week, earnings or not. After subtracting each stock's normal drift, it disappeared. Any "stocks run into earnings" claim built on today's winners has the same flaw.

## What *is* real

1. **The print itself.** The average reaction-day move is **5.5%** (absolute, vs. normal), against about 1.9% on an ordinary day, so roughly 2.8× the usual. The day after averages 3.6%. Small caps and low-priced names move 7–8%, mega caps about 3%.
2. **Attention arrives late.** Volume actually runs *below* normal (0.91–0.95×) from about 15 sessions out to 5 sessions out. It only climbs on day −2 (1.08×) and day −1 (1.35×), then hits 2.0× on the report day. The market doesn't start trading the event until the last two sessions.
3. **No reliable "sell the news."** When stocks are sorted by their 20-day run-up into the print, even the biggest run-ups show no significant reaction-day giveback (t under 1.5 in every fifth).

## What this means for planning

- **Earnings:** there is no generic run-up to catch, so there's no need to start 2 months out. The tradeable thing is the reaction, which falls under the Guide Rule (the forward guide outranks the print). A plan needs the date confirmed and a framework run about **2 weeks (10 sessions) ahead**: enough time to set levels, price a structure, and log the row before the last two sessions, when volume shows up.
- **Not tested here:** option prices (implied volatility) rising into the print. That's widely believed but needs historical option quotes we don't have for free. Treat it as unverified.
- **Non-earnings dated events (data readouts, FDA dates, medical meetings, launches) are a different animal and are not covered by this study.** MRNA (B-828) broke out on 9/17, about 5 weeks before its 10/24 data. That's one instance, not a base rate. The test for these would use the 8-K history of announced events and is the next study.

A base rate is a count of the past, never a buy signal (v28).
