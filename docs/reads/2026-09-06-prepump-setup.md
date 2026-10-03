PRE-PUMP DATASET IS ARMED. First collection Tue 9/8.

WHAT IS SCHEDULED
bench-prepump-snapshot - weekdays 16:30 CT (=17:30 ET). Writes db/prepump/YYYY-MM-DD.ndjson. Silent, no pings.
bench-prepump-outcomes - Saturdays 12:00 CT. Writes db/prepump/outcomes/. Silent.
Both read-only. No orders, no account tools, nothing posted anywhere.

THE UNIVERSE
460 core names, frozen, every one verified live against the API. No dead tickers. Bands: mega 40, large 86, mid 100, small 122, micro 48, low-price 64. Largest sector 14.8 pct. Plus your 2 saved scans, 155 distinct names a day. About 570 symbols a session.

ROWS SO FAR: 0. Monday is Labor Day, so the first real file is Tuesday 9/8.

THREE CORRECTIONS YOU SHOULD KNOW
1. The 8.7x intraday volume figure does not reproduce. Measured 1.67x-2.93x, median 2.77x. Your rule still stands and for a better reason: the intraday feed drops bars unpredictably, and dropouts cannot be corrected for the way a constant could.
2. There is no endpoint that returns a day's official close on that day. Quotes gives the PRIOR session. So the close is stored provisionally and reconciled later, never collapsed into one field.
3. My own error, and the important one. I first froze the universe with a 1 dollar price floor. That deletes GPRO, which traded 4.3-5.4M a day at about 60 cents before a +181 pct move on 24.5x volume. The clearest positive in your book, filtered out by my own rule. Fixed before any data was collected: dollar volume is the floor now, not price.

TWO THINGS FOR YOU
1. Neither saved scan hunts pre-pump. One filters RSI 60-75 and ADX above 25, which is names that already moved. Both floor market cap at 2-3B so neither can see small caps. A third scan with low float, low cap, high relative volume would improve this dataset every single day. I cannot create it, creating a scan is a write.
2. Hunter treats storing daily provider data as a rights decision it says is yours and that it "does not pre-stage." Your brief answers it, personal research, stays on this machine. I wrote that down in the repo and enforced it: market data is gitignored, definitions are versioned. Nothing leaves the PC.

NOTHING FAILED. Both tasks registered and enabled. Full write-up in docs/prepump-dataset-findings.md.
