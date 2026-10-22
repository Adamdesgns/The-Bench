export const meta = {
  name: 'btc-full-suite',
  description: 'v35 framework run on BTC-USD: gather news and levels, judge both sides blind to hunter scores, adversarially verify',
  phases: [
    { title: 'Gather', detail: 'news/flows desk and chart/levels desk in parallel' },
    { title: 'Judge', detail: 'full v35 verdict, both sides, delta on B-800', model: 'opus' },
    { title: 'Verify', detail: 'three lenses try to refute the judge', model: 'opus' },
  ],
}

const C = args
const CTX = `LIVE CONTEXT (pulled by the desk, do not re-derive unless told):
${JSON.stringify(C, null, 1)}`

const HOUSE = `House rules: The Bench is Adam's private trade-hunting system. Motto: proof, not hype. NO INVENTED NUMBERS: every number comes from a file you read, a computation you show, or a source URL you cite; if you cannot verify something, say UNVERIFIED. Never place or suggest placing an order through any tool; research only. Never substitute a ticker: the instrument is BTC-USD spot. Never use IBIT, BITX, BITU, MSTR, COIN or any ETF/option as a stand-in for BTC (Adam's standing rule). Robinhood has no BTC options. Write plain English, define any trading term the first time.`

const NEWS_SCHEMA = { type: 'object', properties: {
  summary: { type: 'string' },
  drivers_last_7_days: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, event: { type: 'string' }, effect: { type: 'string' }, source_url: { type: 'string' } }, required: ['date', 'event', 'source_url'] } },
  etf_flows: { type: 'string', description: 'spot BTC ETF net creations/redemptions by day for the last 1-2 weeks with sources' },
  derivatives: { type: 'string', description: 'funding rates, open interest, liquidations, options positioning, with sources' },
  exchange_and_onchain: { type: 'string', description: 'exchange reserves, whale/miner flows, stablecoin supply, with sources' },
  macro_link: { type: 'string', description: 'how today hot PPI and the 10/28 FOMC odds bear on BTC, with sources' },
  dated_catalysts_next_30_days: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, event: { type: 'string' }, confirmed: { type: 'boolean' }, source_url: { type: 'string' }, why_it_matters: { type: 'string' } }, required: ['date', 'event', 'confirmed'] } },
  robinhood_crypto_order_types: { type: 'string', description: 'does Robinhood Crypto support stop-loss / stop-limit on BTC, do they trigger 24/7, and what spread/fee model applies; cite the Robinhood help page' },
  flows_verdict: { type: 'string', enum: ['accumulation', 'distribution', 'mixed', 'unverified'] },
  bull_evidence: { type: 'array', items: { type: 'string' } },
  bear_evidence: { type: 'array', items: { type: 'string' } },
  unverified: { type: 'array', items: { type: 'string' } },
}, required: ['summary', 'drivers_last_7_days', 'etf_flows', 'derivatives', 'macro_link', 'dated_catalysts_next_30_days', 'robinhood_crypto_order_types', 'flows_verdict', 'bull_evidence', 'bear_evidence'] }

const GEOM = { type: 'object', properties: {
  name: { type: 'string' }, side: { type: 'string', enum: ['long', 'short'] },
  zone_low: { type: 'number' }, zone_high: { type: 'number' }, stop: { type: 'number' }, stop_basis: { type: 'string' },
  stop_atr_multiple_at_zone_edge: { type: 'number' }, target: { type: 'number' }, target_basis: { type: 'string' },
  rr_at_worst_fill: { type: 'number' }, legal: { type: 'boolean' }, why_not_legal: { type: 'string' },
}, required: ['name', 'side', 'stop', 'target', 'legal'] }

const CHART_SCHEMA = { type: 'object', properties: {
  bar_convention: { type: 'string', description: 'which daily bar (UTC day) and whether the 10/15 bar is partial' },
  atr14_wilder_settled: { type: 'number', description: 'ATR(14) Wilder through the last SETTLED daily bar (10/14 UTC)' },
  atr_working: { type: 'string', description: 'show the computation: seed, last 14 TRs' },
  sma20: { type: 'number' }, sma50: { type: 'number' }, sma200: { type: 'number' },
  sma50_slope_5bars: { type: 'string' }, sma200_slope_20bars: { type: 'string' },
  rsi14: { type: 'number' }, volume_ratio_last_settled_vs_20d: { type: 'number' },
  last_settled_close: { type: 'number' }, low20_settled: { type: 'number' }, high20_settled: { type: 'number' },
  pivots_above: { type: 'array', items: { type: 'object', properties: { price: { type: 'number' }, date: { type: 'string' }, kind: { type: 'string' }, atr_away: { type: 'number' } }, required: ['price', 'date'] } },
  pivots_below: { type: 'array', items: { type: 'object', properties: { price: { type: 'number' }, date: { type: 'string' }, kind: { type: 'string' }, atr_away: { type: 'number' } }, required: ['price', 'date'] } },
  b800_level_check: { type: 'array', items: { type: 'object', properties: { level: { type: 'number' }, claim: { type: 'string' }, verified: { type: 'boolean' }, note: { type: 'string' } }, required: ['level', 'claim', 'verified'] } },
  hourly_structure: { type: 'string' },
  geometries: { type: 'array', items: GEOM },
  notes: { type: 'string' },
}, required: ['bar_convention', 'atr14_wilder_settled', 'atr_working', 'sma20', 'sma50', 'sma200', 'rsi14', 'last_settled_close', 'pivots_above', 'pivots_below', 'b800_level_check', 'geometries'] }

const SIDE = { type: 'object', properties: {
  verdict: { type: 'string', enum: ['ENTER', 'CONDITIONAL_WATCH', 'NO_TRADE'] },
  why: { type: 'string' },
  entry_mechanic: { type: 'string' }, zone_low: { type: 'number' }, zone_high: { type: 'number' },
  stop: { type: 'number' }, target1: { type: 'number' }, target2: { type: 'number' },
  rr_at_worst_fill: { type: 'number' }, size_btc: { type: 'number' }, dollar_risk: { type: 'number' }, notional: { type: 'number' },
  funded: { type: 'string' }, decide_by: { type: 'string' }, hard_exit: { type: 'string' },
  opens_it: { type: 'string' }, kills_it: { type: 'string' },
}, required: ['verdict', 'why'] }

const JUDGE_SCHEMA = { type: 'object', properties: {
  headline_verdict: { type: 'string' },
  long: SIDE, short: SIDE,
  b800_delta: { type: 'string', description: 'what changes on the open B-800 plan: still valid as written, needs new geometry, or dead - and why' },
  capital_competition: { type: 'string' },
  regime_and_mode: { type: 'string' },
  fomo_clock: { type: 'string' },
  conviction_tier: { type: 'string' },
  grades: { type: 'object', properties: { technical: { type: 'string' }, fundamental: { type: 'string' }, execution: { type: 'string' }, overall: { type: 'string' } }, required: ['technical', 'fundamental', 'execution', 'overall'] },
  readiness: { type: 'number' }, opportunity_score: { type: 'number' }, confidence_pct: { type: 'number' },
  the_why: { type: 'string' }, bear_case: { type: 'string' }, bull_case: { type: 'string' },
  hodl_call: { type: 'string' },
  watchers: { type: 'array', items: { type: 'object', properties: { when: { type: 'string' }, meaning: { type: 'string' }, expires: { type: 'string' } }, required: ['when', 'meaning', 'expires'] } },
  prediction: { type: 'string', description: 'the forward claim to log in predict.mjs: side, price, horizon sessions, target, stop' },
  report_card: { type: 'object', properties: { verdict: { type: 'string' }, grade: { type: 'string' }, the_number: { type: 'string' }, plan: { type: 'string' }, opens_it: { type: 'string' }, kills_it: { type: 'string' }, next_date: { type: 'string' }, your_call: { type: 'string' } }, required: ['verdict', 'grade', 'the_number', 'plan', 'opens_it', 'kills_it', 'next_date', 'your_call'] },
  open_questions: { type: 'array', items: { type: 'string' } },
}, required: ['headline_verdict', 'long', 'short', 'b800_delta', 'capital_competition', 'grades', 'readiness', 'opportunity_score', 'the_why', 'bear_case', 'watchers', 'report_card'] }

const VERIFY_SCHEMA = { type: 'object', properties: {
  lens: { type: 'string' },
  verdict_upheld: { type: 'boolean', description: 'false only if the headline verdict on either side should change' },
  findings: { type: 'array', items: { type: 'object', properties: { claim: { type: 'string' }, problem: { type: 'string' }, correction: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'material', 'minor'] }, evidence: { type: 'string' } }, required: ['claim', 'problem', 'correction', 'severity'] } },
  corrected_numbers: { type: 'string' },
  missed: { type: 'array', items: { type: 'string' } },
}, required: ['lens', 'verdict_upheld', 'findings'] }

phase('Gather')
const [news, chart] = await parallel([
  () => agent(`${HOUSE}

You are the NEWS, FLOWS AND CATALYST desk for a framework run on BTC-USD (spot bitcoin), today ${C.asof}. The framework's crypto adaptation replaces the insider check with FLOWS: spot-ETF creations vs redemptions, exchange reserves, whale/miner flows, stablecoin supply, funding and open interest. Institutions leaving through ETFs IS the insider-selling signal.

Do this with web search (and fetch pages; if a page bot-walls, read it via curl -sSL "https://r.jina.ai/<URL>"). Do not use the in-app browser.
1. What moved BTC over the last 7 days (10/08-10/15)? It traded about 87.1K on 10/06-ish, broke under 82.6K on 10/08, and is about 81K now. Today a hot PPI print (+1.3% m/m vs +0.6% est) hit risk assets and AI stocks fell for a fifth day; bitcoin miners (IREN, WULF, APLD) fell 9-13% on 10/14. Find the actual reported drivers with dated sources.
2. Spot bitcoin ETF net flows by day for the last two weeks (Farside, SoSoValue, CoinGlass, The Block, or news). Give numbers with sources.
3. Derivatives: funding rates, open interest trend, recent liquidation totals, any large options expiry (Deribit monthly expiry date in late October, CME expiry). Sources.
4. Exchange reserves, whale and miner selling, stablecoin supply trend. Sources.
5. Macro link: the Fed meets 10/27-28 (statement 2:00 PM ET 10/28). What are the current odds of a hike/hold/cut after today's PPI (CME FedWatch or reporting)? How has BTC reacted to the hot CPI (10/14) and PPI (10/15)?
6. DATED CATALYSTS in the next 30 days that could move BTC: policy/regulatory dates (US market-structure bill votes, SEC deadlines, strategic reserve actions), Mt. Gox repayment deadline (verify the current deadline), big unlocks, options/futures expiries, ETF decisions, major conference keynotes. Mark each confirmed or not, with a source.
7. Verify from Robinhood's own help pages: does Robinhood Crypto support stop-loss and stop-limit orders on BTC, do they trigger 24/7, and how does Robinhood price crypto (spread built into the quote, no commission)? Today the Robinhood BTC quote showed bid 80,191.58 / ask 81,721.72 around a mark of 80,956.65, about a 1.9% spread; say whether that is normal for Robinhood.
Return the structured result. Every number needs a source URL or goes in unverified.`, { label: 'news-flows-catalysts', phase: 'Gather', schema: NEWS_SCHEMA, model: 'sonnet' }),
  () => agent(`${HOUSE}

You are the CHART AND LEVELS desk for a framework run on BTC-USD spot, today ${C.asof}. Read the bars file ${C.bars_file} (JSON keys: "BTC-USD_1d" daily bars 2y with fields t (UTC date), open, high, low, close, volume; "BTC-USD_1h" hourly bars last 10 days; "SPY_1d"; "QQQ_1d"). The last daily bar (2026-10-15 UTC) is PARTIAL - today's UTC day is still open. Treat 2026-10-14 as the last SETTLED daily bar. Write a small node script in ${C.scratch_dir} to do the math; show the key working in your answer. Live Robinhood mark: ${C.live.mark} (bid ${C.live.bid}, ask ${C.live.ask}).

Compute and return:
1. ATR(14), Wilder smoothing, through the last settled bar (show seed and the last 14 true ranges). Also SMA 20/50/200 and their slopes, RSI(14) Wilder, last settled volume vs its 20-day average, the 20-bar low and high (settled).
2. VERIFIED PIVOTS: swing highs above the live price and swing lows below it, within 6 ATR, using the full 2y of daily bars. A pivot is a bar whose high (or low) is the extreme of at least 3 bars on each side; note any level with multiple touches (a shelf). Give date, price, distance in ATR.
3. Re-verify every level the open book row B-800 (2026-10-08) relies on, from the bars: 76,228 (prior 20-bar low on 10/08), 76,248 (9/02 pivot), 76,624 (a March-2025 pivot), 74,945 (9/15 low), 82,571 (9/28 swing low), 87,146 and 87,364 (swing highs). Say verified true/false with the actual bar.
4. Hourly structure over the last 3 days (higher lows / lower highs, where the intraday shelves are).
5. GEOMETRIES. The house rules: (a) ATR FLOOR - the stop must sit at least 1.0 ATR(14) from EVERY possible fill in the zone, so for a long zone_low >= stop + ATR; (b) 2:1 measured at the WORST fill, so for a long zone_high <= (target + 2*stop)/3; (c) the target must be a verified pivot, never a moving average and never past 6 ATR; (d) use the TIGHTEST LEGAL STRUCTURAL stop: just beyond a real swing level, and at least 1.0 ATR from the zone edge. Shorts mirror all of this. Compute and return each of these, marking legal or not and why:
   G1 "B-800 as written": long, zone 76,228-76,600 holding a daily close, stop 74,900 (under 74,945), target 87,146. Check the ATR floor at today's ATR.
   G2 "B-800 repaired": the same dip-buy floor zone with the tightest legal stop under the floor cluster that clears 1.0 ATR from the zone bottom, target the nearest verified pivot that still gives 2:1 at the zone top.
   G3 "long now": a long near the live price, tightest legal structural stop, nearest verified pivot target; does a legal 2:1 zone containing the live price (use the ASK as the fill) exist?
   G4 "short now": a short near the live price (fill at the BID), tightest legal structural stop above, target = the FIRST verified floor below; then also against the next floor. Report both R:R.
   G5 "short on breakdown": a short only after a settled daily close under the B-800 floor cluster, stop above the cluster, target the next verified floor.
Return the structured result.`, { label: 'chart-levels', phase: 'Gather', schema: CHART_SCHEMA, model: 'sonnet' }),
])

phase('Judge')
const judge = await agent(`${HOUSE}

You are the JUDGE for a full framework run on BTC-USD (spot bitcoin) for Adam, today ${C.asof}. Apply the framework in ${C.framework} (v35). Read at least these sections in full before judging: DATA INTEGRITY, THE ACCUMULATION TRIGGER, THE INSTRUMENT MENU, THE ATR FLOOR, THE SHORT-SIDE / HEDGE TRIGGER, THE CONVICTION TIER, QUANT EVIDENCE, READINESS SCORE, CRYPTO ADAPTATION, THE FOMO CLOCK, THE SECOND-HAND CATALYST RULE, POSITION SIZING, THE TRADE PLAN, PASSED TRIGGERS ARE WATCHED, MANAGING OPEN POSITIONS (delta mode), THE CAPITAL COMPETITION TEST, GRADING & SCORING, THE BENCH VERDICT, THE HODL CALL, REQUIRED OUTPUT FORMAT. AI BULL MARKET MODE applies to the AI/semis theme only; it does not loosen any rule for BTC.

Also read the open book row B-800 and the 9/21 BTC rows B-481, B-485, B-494, B-495, B-500 from ${C.repo}/db/archive.json (node -e one-liners). B-800 is OPEN until 10/22, so this run is a DELTA on it, not a fresh thesis: say exactly what changed and whether its plan stands, needs repair, or is dead.

${CTX}

THE NEWS/FLOWS DESK REPORTED:
${JSON.stringify(news, null, 1)}

THE CHART/LEVELS DESK REPORTED:
${JSON.stringify(chart, null, 1)}

You have NOT been shown the hunters' scores on purpose (v29: grade before reading the hunter). Do not go looking for db/hunts files.

Judge BOTH sides; the short side is evaluated on every scan. Key facts and rules to honor:
- Robinhood crypto is spot, cash, long only: BTC cannot be shorted on this account. A short verdict can only be a paper call or a reason to stand aside; say so.
- Fills: Robinhood's quote carries about a 1.9% spread. A long fills near the ASK, a sale near the BID. Account for it in the worst-fill R:R and in the dollar risk.
- Size from the 10% band: ${C.account.band} (account ${C.account.total}). Never gate or rank a call on buying power; state size from the band, then say what is funded with crypto buying power ${C.account.crypto_buying_power}.
- Entry mechanic for a 24/7 asset: there is no first-30-minute bar. Define the signal (which daily close: say UTC-day close or a CT clock time, and why) and how the desk's close routine and mind-changer watchers will check it. The house weekend rule exists because equity stops sleep over weekends; say whether and how it applies to BTC (crypto trades all weekend, with thinner liquidity).
- The Fed statement is 2:00 PM ET 10/28; say whether any plan must be flat before it.
- Readiness under 50 = watchlist only. Grades A+..F; leave fundamental null only if you truly cannot grade value capture/flows.
- Every passed trigger and every level in the plan gets a watcher (write conditions as BTC-USD>LEVEL or BTC-USD<LEVEL with a meaning and an expiry date). Existing watchers MC-108 (BTC-USD<76228) and MC-109 (BTC-USD>82571) expire 10/22; say if they should stay, change, or be joined by new ones.
- End with the REPORT CARD fields in plain English.`, { label: 'judge-v35', phase: 'Judge', schema: JUDGE_SCHEMA, model: 'opus' })

phase('Verify')
const LENSES = [
  { key: 'math-levels', prompt: `LENS: MATH AND LEVELS. Recompute from the bars file ${C.bars_file} (write your own node script in ${C.scratch_dir}; the 10/15 UTC daily bar is partial, 10/14 is the last settled). Re-check ATR(14) Wilder, every pivot the judge uses as a stop or target (is it really a swing extreme with 3 bars each side? is there a nearer pivot the judge skipped?), the ATR floor at the zone edge, 2:1 at the worst fill INCLUDING the ~1.9% Robinhood spread (long fills at the ask, about 0.95% over mark), the size from the band ${C.account.band} and the dollar risk. As a cross-check you MAY now read the hunters' receipts ${C.hunter_files.join(' and ')} (they were hidden from the judge on purpose) and report where their geometry disagrees with the judge's and who is right.` },
  { key: 'framework', prompt: `LENS: FRAMEWORK COMPLIANCE. Read ${C.framework} (v35) and check the judge's work rule by rule: both sides evaluated; short gates; the Capital Competition Test on BOTH the 20- and 60-session windows (note the crypto calendar problem described in the live context and say which measurement the rule intends and whether the conclusion changes); readiness rubric and the under-50 watchlist rule; the grade/score bounds; the second-hand catalyst rule; the accumulation trigger; passed triggers are watched; the delta-mode treatment of open row B-800 (read it in ${C.repo}/db/archive.json); dead theses; the entry mechanic for a 24/7 asset; the Fed 10/28 handling; the never-substitute-a-ticker rule; that Robinhood crypto cannot be shorted. Flag anything the verdict gets wrong under the written rules.` },
  { key: 'data-news', prompt: `LENS: DATA AND NEWS. Re-open the news desk's sources (web search / fetch; via curl -sSL "https://r.jina.ai/<URL>" if bot-walled; no in-app browser) and check: are the dates right, do the numbers match the source, is anything presented as fact actually unverified, did the desk miss a dated catalyst in the next 30 days (Mt. Gox deadline, options/futures expiries, US policy votes, ETF decisions, Fed speakers), and is the ETF-flow and derivatives picture the judge leaned on accurate as of today. Also verify the Robinhood crypto order-type claim (stop-loss/stop-limit on BTC, 24/7 triggering) from Robinhood's help pages.` },
]
const verdicts = await parallel(LENSES.map(L => () => agent(`${HOUSE}

You are an ADVERSARIAL VERIFIER. Your job is to REFUTE the judge's BTC-USD verdict below if it is wrong, and to correct any number that is wrong. Default to skepticism; only uphold what survives your own check. ${L.prompt}

${CTX}

THE JUDGE'S VERDICT:
${JSON.stringify(judge, null, 1)}

THE INPUTS THE JUDGE HAD:
NEWS: ${JSON.stringify(news)}
CHART: ${JSON.stringify(chart)}

verdict_upheld = false only if the headline verdict on the long side or the short side should change. List every finding with severity (blocker = changes a verdict or a level Adam would act on; material = a wrong number or missed rule that should be fixed in the record; minor = wording).`, { label: `verify:${L.key}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' })))

return { news, chart, judge, verdicts }
