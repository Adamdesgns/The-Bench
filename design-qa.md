# Design QA — Screenshot Match

## Target and state

- Exact source supplied by Adam: `C:\Users\steam\AppData\Local\Temp\codex-clipboard-a6c0c26a-1db0-4f70-81c2-66bb39c5d15a.png`
- Source pixels: 1487 × 1058
- Tested implementation state: local Desk, PODD selected, Open board filter, eight visible rows
- CSS viewport: 1440 × 900
- Browser-reported density: DPR 1.0; the desktop capture surface returned 2520 × 1575 because of Windows display scaling, then was normalized to the CSS viewport for comparison

## Comparison evidence

- Normalized implementation capture: `qa/implementation-desk-final.png`
- Full side-by-side comparison: `qa/comparison-final.jpg`
- Focused section comparison: `qa/comparison-focused.png`
- Compared sections: ticker and masthead, selected-research strip, evidence drawer, open board, and capital scoreboard

## Iteration history

1. **Failed baseline — P1:** the prior layout treated the selected concept as loose inspiration. It had an oversized command bar, the wrong hero texture, text abbreviations instead of icons, incorrect vertical proportions, and the wrong information hierarchy.
2. **Structure pass:** rebuilt the 41px ticker, 105px masthead, 86px navigation rail, 235px selected-research strip, 408px board, and 111px capital bar to match the source proportions at 1440 × 900.
3. **Asset pass:** kept the torn gold-leaf wordmark and added a separate generated obsidian-and-gold-leaf sweep for the selected-research background. Added the Phosphor icon font for the rail, evidence, play, caret, and overflow icons.
4. **Density pass:** limited the open board to eight rows, aligned the table columns, restored green PASS/LONG and HIGH states from the source, and matched the selected PODD rationale wrapping.
5. **Final comparison:** placed source and implementation in the same normalized comparison inputs. No P0, P1, or P2 visual mismatches remain. Remaining differences are truthful data differences: the ticker is labeled LOCAL and uses archived review prices/call states rather than pretending the local book is a live quote feed.

## Functional and accessibility checks

- Desk is the default view.
- Board row selection still updates the selected research.
- Open, Closed, and All filters remain interactive.
- Run Research remains connected to the existing real research action.
- Board, Book, Audit, and Settings navigation remains available through icon-and-text buttons.
- Semantic headings, labels, table headers, focus treatment, status regions, and the reduced-motion ticker rule remain in place.
- Browser console contained no warnings or errors in the final state.

## Final result

final result: passed
