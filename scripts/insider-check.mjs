#!/usr/bin/env node
// insider-check.mjs — the v24 insider/smart-money check, straight from SEC EDGAR.
// Zero-dep, read-only, free. Replaces the paid financial-datasets insider feed.
//
//   node scripts/insider-check.mjs --ticker APP [--days 180] [--max 12]
//
// Pulls recent Form 4 filings, reads the actual transactions, and answers the
// framework's question: are insiders BUYING (open-market P) or SELLING (S)?
// Routine comp noise (grants A, option exercises M, tax withholding F, gifts G)
// is counted but never treated as a conviction signal.
//
// SEC fair-access rules: identified User-Agent, sequential requests, small delay.

const UA = 'TheBench-research/1.0 (contact: steamercook@yahoo.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const TICKER = (arg('ticker') || '').toUpperCase().replace(/^\$/, '');
const DAYS = Number(arg('days', 180));
const MAX = Number(arg('max', 12));

if (!TICKER) {
  console.error('REFUSED — no ticker. Usage: node scripts/insider-check.mjs --ticker APP [--days 180] [--max 12]');
  process.exit(1);
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}
async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.text();
}

// Pull <tag><value>x</value></tag> or <tag>x</tag>, first match inside a block.
function xmlVal(block, tag) {
  const m =
    block.match(new RegExp(`<${tag}>\\s*<value>([^<]*)</value>`, 'i')) ||
    block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

const CODE_LABEL = {
  P: 'OPEN-MARKET BUY',
  S: 'OPEN-MARKET SELL',
  A: 'grant/award',
  M: 'option exercise',
  F: 'tax withholding',
  G: 'gift',
  D: 'disposition to issuer',
  C: 'conversion',
  X: 'option exercise (in/out)',
  J: 'other',
  W: 'will/inheritance',
};

const money = (n) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n).toLocaleString('en-US')}`;

try {
  // 1) ticker → CIK
  const tickers = await getJson('https://www.sec.gov/files/company_tickers.json');
  const hit = Object.values(tickers).find((t) => t.ticker.toUpperCase() === TICKER);
  if (!hit) {
    console.error(`REFUSED — ${TICKER} not found in EDGAR's ticker map. Wrong/foreign/delisted symbol?`);
    process.exit(1);
  }
  const cik10 = String(hit.cik_str).padStart(10, '0');

  // 2) recent filings → Form 4s inside the window
  const subs = await getJson(`https://data.sec.gov/submissions/CIK${cik10}.json`);
  const r = subs.filings.recent;
  const cutoff = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
  const picks = [];
  for (let i = 0; i < r.form.length && picks.length < MAX; i++) {
    if ((r.form[i] === '4' || r.form[i] === '4/A') && r.filingDate[i] >= cutoff) {
      picks.push({
        accn: r.accessionNumber[i].replace(/-/g, ''),
        filed: r.filingDate[i],
        doc: (r.primaryDocument[i] || '').replace(/^.*\//, ''),
        amended: r.form[i] === '4/A',
      });
    }
  }

  console.log(`\n${hit.title} (${TICKER}) — Form 4s, last ${DAYS} days — SEC EDGAR, CIK ${hit.cik_str}`);
  if (picks.length === 0) {
    console.log(`\nQUIET — no Form 4 filings in the window. No insider signal either way.`);
    process.exit(0);
  }
  if (picks.length === MAX) console.log(`(showing the ${MAX} most recent — raise --max for more)`);

  // 3) read each filing's actual transactions (Table I, non-derivative)
  const tally = { P: { sh: 0, usd: 0, n: 0 }, S: { sh: 0, usd: 0, n: 0 }, other: {} };
  let missingPrice = false;

  for (const p of picks) {
    await sleep(150);
    let xml;
    try {
      xml = await getText(`https://www.sec.gov/Archives/edgar/data/${hit.cik_str}/${p.accn}/${p.doc}`);
    } catch (e) {
      console.log(`  ${p.filed}  [could not read filing ${p.accn}: ${e.message}]`);
      continue;
    }
    const owner = (xml.match(/<rptOwnerName>([^<]*)<\/rptOwnerName>/gi) || [])
      .map((s) => s.replace(/<[^>]+>/g, '').trim())
      .join(' + ') || 'unknown owner';
    const title =
      xmlVal(xml, 'officerTitle') ||
      (/<isDirector>\s*(1|true)/i.test(xml) ? 'Director' : '') ||
      (/<isTenPercentOwner>\s*(1|true)/i.test(xml) ? '10% owner' : '');

    const txs = xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/gi) || [];
    const lines = [];
    for (const t of txs) {
      const code = xmlVal(t, 'transactionCode') || '?';
      const shares = parseFloat(xmlVal(t, 'transactionShares')) || 0;
      const price = parseFloat(xmlVal(t, 'transactionPricePerShare')) || 0;
      const usd = shares * price;
      if (code === 'P' || code === 'S') {
        tally[code].sh += shares;
        tally[code].usd += usd;
        tally[code].n += 1;
        if (!price) missingPrice = true;
      } else {
        tally.other[code] = (tally.other[code] || 0) + 1;
      }
      lines.push(
        `${CODE_LABEL[code] || `code ${code}`}: ${Math.round(shares).toLocaleString('en-US')} sh` +
          (price ? ` @ ${price} (${money(usd)})` : '')
      );
    }
    console.log(
      `  ${p.filed}  ${owner}${title ? ` (${title})` : ''}${p.amended ? ' [AMENDED]' : ''}` +
        (lines.length ? `\n${lines.map((l) => `             ${l}`).join('\n')}` : '\n             [no Table I transactions — derivative-only filing]')
    );
  }

  // 4) the framework's answer
  const { P, S } = tally;
  const otherStr = Object.entries(tally.other)
    .map(([c, n]) => `${n}× ${CODE_LABEL[c] || c}`)
    .join(', ');
  console.log(`\n--- INSIDER READ (open-market only; comp noise excluded) ---`);
  console.log(`  Buys (P):  ${P.n} transactions · ${Math.round(P.sh).toLocaleString('en-US')} sh · ${money(P.usd)}`);
  console.log(`  Sells (S): ${S.n} transactions · ${Math.round(S.sh).toLocaleString('en-US')} sh · ${money(S.usd)}`);
  if (otherStr) console.log(`  Routine:   ${otherStr} — not a conviction signal`);
  if (missingPrice) console.log(`  NOTE: some transactions had no price in the filing — $ totals are a floor.`);

  let verdict;
  if (P.n && !S.n) verdict = 'INSIDERS BUYING — open-market purchases, no sales. Bullish conviction signal.';
  else if (S.n && !P.n) verdict = 'DISTRIBUTION — open-market selling only. Bearish overhang signal.';
  else if (P.n && S.n)
    verdict = `MIXED — net ${P.usd >= S.usd ? 'buying' : 'selling'} of ${money(Math.abs(P.usd - S.usd))}. Weigh who is doing which.`;
  else verdict = 'NO CONVICTION SIGNAL — only routine comp activity (grants/exercises/withholding). Neutral.';
  console.log(`  VERDICT:   ${verdict}\n`);
} catch (e) {
  console.error(`EDGAR pull failed — ${e.message}`);
  console.error('Treat the insider leg as "not observable from here" for this run. Do NOT guess.');
  process.exit(1);
}
