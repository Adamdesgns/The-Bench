# THE BENCH — BRAND FILE
*Handoff document for design work. Everything a designer (human or AI) needs to produce on-brand output. Treat every value in here as canon unless Adam says otherwise.*

---

## 1. IDENTITY

- **Name:** THE BENCH
- **Descriptor:** Swing Trade Research
- **Handle:** @TheBenchTrades (X — primary channel)
- **Tagline:** "Disciplined setups. Proof, not hype."
- **Short sign-off:** "Proof, not hype."
- **What it is:** An independent trading research channel that grades setups with an institutional framework, publishes every call — wins AND losses — and logs a public track record (the Bench Archive).
- **Positioning in one line:** Institutional-quality research for individual traders. Think **Morningstar / Morgan Stanley / Goldman Sachs — written for a swing trader.**
- **What it is NOT:** Not a signal service. Not a guru account. Not YouTube-thumbnail hype, not Reddit, not CNBC theatrics. "No Trade" is a successful outcome.

**Logo:** Gold candlestick marks forming a bench silhouette + THE BENCH wordmark + tagline, on black. The logo's native background is pure black (#000) — composite it onto brand ink (#111111) with a lighten blend so it sits seamlessly with no visible box. Never place on white. Never recolor. Give it air: minimum clear space equal to the height of the wordmark's "B."

---

## 2. VOICE & TONE

- **Terse. Evidence-first. Zero hype.** Numbers before adjectives. Receipts before opinions.
- **Honest to a fault:** losses are published with the same visibility as entries. Corrections are made loudly ("the verified low is $950, not $864").
- **Even-handed:** always give the bull AND bear case. Credit other people's ideas warmly (quote-tweets, replies) — collaborate, don't dunk.
- **Politically neutral:** political events are treated purely as market catalysts to evaluate. Never take a side.
- **Never accusatory:** unproven claims are labeled "alleged"/"flagged." Facts about incentives can be stated; motives are never assigned.
- **Signature phrases (reusable):**
  - "Proof, not hype."
  - "Trade levels, not narratives."
  - "A famous stake is a reason to look. Never a reason to buy."
  - "Verify the filing, not the screenshot of the filing."
  - "Unless you're the wallet, you're the volume."
  - "The mention is the receipt, not the catalyst."
  - "No Trade is a successful outcome."
- **Formatting rules for X:** NO numbered threads (no "1/8"). Plain text only (X strips markdown) — caps for section heads in long-form, dashes/bullets sparingly. Emojis almost never; 👇 and 🤝 are the only sanctioned ones, max one per post. Every public post ends: "Proof, not hype." + follow line + "Not financial advice."

---

## 3. COLOR — EXACT TOKENS

| Token | Hex | Use |
|---|---|---|
| **Ink (bg)** | `#111111` | Primary background everywhere. Full-bleed — on PDF, set page background so margins are never white. |
| **Card black** | `#1A1916` | Card / panel surfaces (warm black, sits on Ink). |
| **Card edge** | `#26241F` | 1px borders, dividers on dark. |
| **Metallic gold (primary accent)** | `#D4AF37` | Headlines, grade seals, rules, active states, the wordmark. The ONLY accent color. |
| **Gold dim** | `#9A7E28` | Secondary gold — muted labels, left-border rules, inactive gold. |
| **Pale gold** | `#F5ECCB` | Highlight text, big numerals, seeded-row highlight. |
| **Bone** | `#E8E4DA` | Body text on dark. |
| **Slate** | `#8F8A7A` | Muted/meta text, labels. |
| **Loss red** | `#E5484D` | Losses, stopped-out stamps, down moves — the only permitted red. (Deep variant `#7A2A2E` for borders.) |
| **White** | — | Avoid. Light backgrounds are off-brand except inside spreadsheet cells. |

Rules: gold is precious — use it for hierarchy, never for large fills. Red appears ONLY for losses/negative outcomes, never decoratively. No other hues (no blue, green, purple). Green is deliberately absent — even wins are told in gold.

---

## 4. TYPOGRAPHY

- **Display / headlines / tickers / big numerals:** **EB Garamond** (600–700). Fallback: Georgia, serif. Letterspacing on the wordmark: ~0.14em, all caps.
- **Body / data / UI / labels:** **Inter** (400–700). Fallback: system-ui, sans-serif.
- **Label style:** 9–11px, UPPERCASE, letterspacing 0.14–0.32em, Slate color.
- **Lessons / editorial asides:** EB Garamond *italic* in Pale gold.
- Never: Arial-as-display, rounded/playful fonts, condensed fonts, more than these two families.

---

## 5. SIGNATURE DEVICES
*(the recognizable elements — use at least one per artifact)*

1. **The stamp seal:** the Overall grade (A+–F) in a circular 2px gold border, EB Garamond bold, rotated **−8°**, subtle inner shadow ring — like a rubber stamp on an institutional memo. Losses stamp in Loss red. This is the brand's #1 device.
2. **The gold rule:** 1px horizontal divider as a gradient — `transparent → gold → transparent`. Used under mastheads and above footers.
3. **The gold left-border callout:** 3px `#9A7E28` left rule on a Card-black panel — for risk notes and key callouts (inherited from the research PDF).
4. **The score bar:** thin (4px) progress bar, `gold-dim → gold` gradient, on Card-edge track — for the Opportunity Score (0–100).
5. **The ledger card:** one call per card — ID + date, ticker in Garamond, grade chips (Tech/Fund/Exec), seal, meta line. Newest first.
6. **The masthead:** centered wordmark in gold Garamond caps, tagline in letterspaced Slate caps beneath, gold rule, then a meta strip (handle left · issue/date right).

---

## 6. THE GRADING SYSTEM (what designs must display)

- **Four-Part Grades:** Technical · Fundamental · Execution · **Overall** (A+ to F, minus grades allowed). Overall gets the stamp; the other three are small chips.
- **Opportunity Score:** 0–100, always grade-bounded (A→100 · B→89 · C→69 · D→49 · F→29). Shown with the score bar.
- **FOMO Clock:** Pre-FOMO · Heating Up · Late FOMO · Post-FOMO Fade.
- **Market Risk:** 1–5.
- **Final Call:** A+ Setup · Setup Forming · Setup Working — Manage · Watchlist Only · No Trade · Stopped — Closed.
- **HODL Call:** Accumulate · Hold-quality — wait for value · Trade-only — not a hold.
- **Archive ID:** sequential `B-###` — always visible on any call artifact.

---

## 7. SURFACES & THEIR RULES

- **Research PDF (issues No. 001…):** A4, full-bleed Ink (set `@page` background), margins 18mm 20mm 16mm 20mm, logo masthead (~110px) + meta strip, institutional sidehead grid (Overview / Chart Analysis / Market Mood / Insider Activity / Risk / Trade Plan / Options / The Trap / Bottom Line), gold grade badge, trade-plan table, footer = gold rule + @TheBenchTrades + "Educational Purposes Only — Not Financial Advice" + page number. Target: clean 2 pages.
- **Mobile archive (HTML):** single column, max-width 520px, stat strip, filter chips (gold active state), ledger cards with seals. Screenshot-friendly by design.
- **Tracker (xlsx):** black header rows with gold text, pale-gold seeded rows, loss rows tinted red, dashboard sheet.
- **X posts:** plain text; threads unnumbered; long-form uses CAPS section heads; every post closes with the boilerplate. Charts/cards attached as images should be crops of the branded artifacts above, not new one-off styles.

---

## 8. BOILERPLATE STRINGS (copy exactly)

- Footer/disclaimer: `Educational Purposes Only — Not Financial Advice`
- Post close: `Proof, not hype.` + `Follow @TheBenchTrades.` + `Not financial advice.`
- Masthead tagline: `Disciplined setups. Proof, not hype.`
- Archive subtitle: `Every Call · On the Record`

---

## 9. DO / DON'T

**Do:** matte black everything · gold as scarce hierarchy · serif tickers · stamped grades · show the loss as proudly as the win · dense-but-scannable · cite the number, not the vibe.

**Don't:** white backgrounds · green candles/green accents · more than two typefaces · emojis in artifacts · numbered threads · rocket ships, fire, or any hype iconography · rounded-bubbly "fintech app" aesthetics · neon/cyberpunk gradients · watermarks over data.

*The test for any new design: would it look at home printed on the desk of an institutional research analyst who happens to have excellent taste — and would a follower recognize it as THE BENCH with the logo covered?*
