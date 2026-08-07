# Design QA — Obsidian Market Hall

## Target and evidence

- Selected target: `C:\Users\steam\.codex\generated_images\019fde67-f765-7322-b8ac-4eafc8044374\exec-bd1e5596-8c0e-407d-8b55-47bed2c1f483.png`
- Target pixels: 1487 × 1058
- Implementation capture: `qa/implementation-desk-final.png`
- Comparison input: `qa/comparison-final.jpg`
- Browser state: local Desk, PODD selected, Open board filter
- Browser viewport: 1280 × 720 CSS pixels, DPR 1.75

## Comparison summary

The implementation preserves the selected direction's essential hierarchy: full-width tape, gold-leaf masthead, narrow navigation rail, selected-thesis hero, evidence surface, full-width research ledger, and capital scoreboard. The implementation intentionally keeps the app's real local archive, controls, and research-only capability boundary instead of inventing live prices or unsupported order actions.

## Resolved findings

1. **P1 — Wordmark texture looked painted rather than metallic.** Replaced the original asset with a generated real-metal leaf texture based on Adam's references: overlapping sheets, visible seams, sharp reflective ridges, and deep creases. The texture is clipped only inside the masthead letters.
2. **P1 — Long thesis copy could overwhelm the selected-research hero.** The renderer now separates a concise first-sentence verdict from the supporting rationale, with a two-line safety clamp on the verdict.
3. **P1 — Research controls created an extra horizontal band and pushed the ledger down.** The controls now live inside the selected-research hero, matching the target hierarchy and returning the board to the first screenful.
4. **P2 — Desktop density drifted larger than the target.** Reduced masthead, rail, controls, and thesis typography; the final 1280px layout has no horizontal page overflow and all primary surfaces remain within their grid bounds.

## Functional and accessibility checks

- Desk, Generate, and return navigation work.
- Selecting B-033 updates the thesis from PODD to GOOGL.
- Open and Closed filters update the ledger.
- No browser console errors were present after the interaction pass.
- The tape animation is disabled when reduced motion is requested.
- Existing semantic buttons, labels, table headers, skip link, status region, and focus treatment are retained.

## Accepted deviations

- Positive states remain gold instead of green because The Bench's established brand rule is “no green.” Losses remain red.
- The tape identifies itself as a local board tape and uses dated archive values. It does not falsely present those values as live market quotes.
- The implementation uses the app's existing text navigation labels rather than introducing a new icon dependency solely to imitate the concept image.

## Final result

passed
