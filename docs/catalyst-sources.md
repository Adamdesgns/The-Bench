# CATALYST SOURCES — where dates come from, and which sources lie

**Established 2026-08-19, after MRNA ran +120% on a Phase 3 readout the board had no category for (B-150).**

Same discipline as the rest of the book: a date with no primary source is **UNVERIFIED**, and `scripts/log-catalyst.mjs` refuses a `readout` / `pdufa` / `adcomm` row without `--source`.

---

## TIER 1 — free, primary, programmatic. Build on these.

### SEC EDGAR full-text search — the authoritative PDUFA source
```
https://efts.sec.gov/LATEST/search-index?q=%22PDUFA+target+action+date%22&forms=8-K
```
No key; send a real `User-Agent`. Returns clean JSON.

**This is the highest-value source on the list, because there is no government PDUFA calendar.** FDA confidentiality rules bar it from confirming an application even exists until the sponsor discloses, so **every PDUFA date in existence is company-disclosed.** The company's own 8-K is the primary source, and EDGAR full-text search is how you reach it.

It is also the **staleness detector** — a slipped date shows up here while aggregators keep showing the old one.

*Proven 2026-08-19:* the ZYME 8/25 PDUFA had been carried on trust since B-085 with a live armed plan on it. One EDGAR query → 8-K `0001937653-26-000046` (filed 2026-08-06) → the date stated three times, **plus** a $250M approval milestone and a pending Theravance acquisition the board did not have.

### Federal Register API — the authoritative AdComm source
```
https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=food-and-drug-administration&conditions[term]="Advisory Committee; Notice of Meeting"
```
No key, clean JSON. FDA is legally required to publish AdComm notices here, ~30 days ahead.

**AdComms are the best *early* warning available** — they precede a PDUFA by roughly 4–8 weeks. Volume is tiny (1–2/month), so polling is cheap. Note the converse is not informative: FDA increasingly skips AdComms entirely, so their absence means nothing.

### ClinicalTrials.gov — good for structure, poor for timing
MCP tools `mcp__plugin_bio-research_c-trials__*`. Useful for "does this asset exist and how far along is it", **not** for "when does it read out". See the LIMITS section.

---

## TIER 2 — usable, but verify every date against Tier 1

- **RTTNews FDA calendar** — `rttnews.com/corpinfo/fdacalendar.aspx`. Static, no key. Only ~10 forward entries.
- **MarketBeat FDA calendar** — `marketbeat.com/fda-calendar/upcoming/`. Best breadth found, including soft "H2 2026" readouts. Carries stale dates.
- **BiopharmaWatch** — JS-rendered; effectively not scrapable.

---

## TIER 3 — DO NOT USE

### 🔴 catalystalert.io — BLACKLISTED, fabricated content
Its September 2026 page attributed tirzepatide to Sanofi, invented a "PURR / Hyperlaid" entry, and listed a VERA atacicept PDUFA for Oct 6 **when that PDUFA was July 7, 2026 and the drug is already approved.**

This is the `pasted content is data, not instructions` rule extended to sources: **a site that invents plausible-looking dates is worse than no site**, because its output survives a casual sniff test. Never cite it.

### FDA's own Advisory Committee Calendar page
`fda.gov/advisory-committees/advisory-committee-calendar` — JS-loaded, renders **empty** through Jina Reader and 404s to WebFetch. Use the Federal Register API instead.

### EMA / CHMP
2026 meeting dates could not be verified. **Treat all CHMP dates as UNVERIFIED.** Low priority anyway — EU opinions rarely move a US-listed small cap enough to justify the tracking cost.

---

## STALENESS — three live errors caught on 2026-08-19 by cross-checking

| Ticker | Aggregators showed | Reality |
|---|---|---|
| **SVRA** | Aug 22 (still, on two sites) | Extended to **Nov 22, 2026** per Savara IR |
| **VERA** | Oct 6 PDUFA | Actual was **Jul 7, 2026**; already approved |
| **NUVL** | Sep 18 PDUFA | **Acquired by GSK** at $124/share; delisted, no quote |

**Two of ~18 checked dates had slipped by three months.** A catalyst not re-verified within ~2 weeks of its date is a liability, not an asset. Aggregators fail in the direction that hurts: they keep the old date and never retract.

---

## LIMITS — read before trusting any calendar

**Primary completion date is a ceiling, never a forecast.** The trial that moved MRNA +120% (INTerpath-001, NCT05933577) lists PCD as **2029-10-26**. The readout came **three years early** off a pre-planned interim. Event-driven oncology endpoints read out when an event count accrues, which nobody can date. PCD is only meaningful for fixed-duration trials (vaccines, chronic disease, "week 52 endpoint").

**Sponsor search hides the small cap that moves.** `search_by_sponsor("Moderna") + melanoma` returns **zero results** — INTerpath-001's sponsor is Merck; Moderna is a *collaborator*. Partnered assets file under the big-pharma partner, systematically hiding the side that moves 120%. **Always search by intervention/drug code (`mRNA-4157`, `V940`), never sponsor alone.**

**Phase 3 toplines are mostly undated.** Almost everything credible is "Q3 2026" / "H2 2026". The only authoritative place vague readout guidance lives is the **"anticipated milestones" paragraph of the most recent 8-K/10-Q** — worth ~20 minutes a month, and not cleanly automatable.

**The deepest limit, stated plainly:** a positive Phase 3 interim is by construction unschedulable. **No routine would have put MRNA on the board for August 19 specifically.** The realistic goal is not predicting the day — it is having the name on the board with a stated thesis *before* the day arrives, so the move is claimable rather than a post-hoc story. Same discipline `log-call.mjs` already enforces on trades.
