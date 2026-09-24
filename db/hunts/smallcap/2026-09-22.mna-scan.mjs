import { readFileSync } from "node:fs";
const UA = "TheBench research steamercook@yahoo.com";
const tick = JSON.parse(readFileSync("tickers.json","utf8")); const map = {}; for (const r of Object.values(tick)) map[r.ticker] = String(r.cik_str).padStart(10,"0");
const syms = process.argv[2].split(",");
const DEAL = /^(DEFM14A|PREM14A|SC TO-T|SC 14D9|425|DEFM14C|PREM14C|SC 13E3)$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const s of syms) {
  const cik = map[s]; if (!cik) { console.log(s.padEnd(5), "no CIK"); continue; }
  const x = await (await fetch(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=exclude&count=40&output=atom`, { headers: { "User-Agent": UA } })).text();
  const entries = [...x.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => ({ t: (m[1].match(/<filing-type>([^<]*)/)||[])[1], d: (m[1].match(/<filing-date>([^<]*)/)||[])[1], i: (m[1].match(/<items-desc>([^<]*)/)||[])[1] || "" }));
  const hits = entries.filter(e => e.d >= "2026-03-01" && (DEAL.test(e.t) || (e.t === "8-K" && /1\.01/.test(e.i))));
  console.log(s.padEnd(5), hits.length ? "DEAL FLAGS: " + hits.slice(0,4).map(h => `${h.t}${h.t==="8-K"?"(1.01)":""} ${h.d}`).join(", ") : "clean");
  await sleep(150);
}
