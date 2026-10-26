# Step-by-step audit method for the V23 typesetting engine

## Purpose

This method investigates a geometry finding by tracing the engine's actual decisions and corrections, not only comparing the final page. Instrumentation is diagnostic-only and must not change typesetting decisions.

For each issue, the investigation must establish: (1) which text/block is affected and the role the engine assigned it; (2) the layout decision and intermediate geometry; (3) every relevant element added, removed, moved, resized or restyled on the same page after the target first appeared; (4) which operation created the defect, failed to apply a correction, or reverted a correction; and (5) whether the issue was newly created, only became measurable later, or remained because no legal candidate/capacity existed.

## Current instrumentation points

The browser recorder takes page-relative snapshots/deltas around these functions:

- `createPageLayout`: page's initial structure.
- `renderSingleItemFast`: insertion of a paragraph/heading fragment.
- `balanceColumns`: entry/exit of two-column balancing.
- `justifyColumnVertically` and `shrinkColumnVertically`: vertical correction attempts.
- `tryReclaimOrphanTail`: orphan-tail reclaim.
- `flushFootnotesInto`: insertion/reservation of footnotes.
- `repositionOverflowingSideNotes`, `repositionBlockNotes`: side-note placement.
- `fitSectionDividerToPage`, `fitColumnDividers`: divider fitting.
- `stretchLastBlockToBottom`: final block stretch.
- `applyCrossParagraphParens`: parenthetical styling pass.
- `recordLayoutGeometryStage`: existing checkpoints such as `postfit`, `after-orphan-reclaim`, `after-page-final-justify`, `canonical-final`.

Every event records operation, phase (`before`, `after`, `throw`), page index/label, target identity, body-flow/footnote metrics, and deltas of added/removed/changed layout-relevant elements. Element records include semantic role, token ID, text preview, page-relative rectangle, line count/line rectangles, selected `data-layout-*` decision attributes and computed typography. The inventory includes paragraphs, continuation fragments, headings, columns, footnotes, side notes, note markers, ornaments, dividers, headers and footers; it deliberately omits ordinary inline spans that do not have a layout-specific role.

The report stores the full trace under `geometry.stepByStepAudit.pages`. Each final issue has `stepByStepTrace` with the first matched appearance event (when found), target-touch event indexes, a candidate window through the last event on the page, and completeness status. The window intentionally includes changes to *other* elements: these may reveal that a repair for one block consumed space needed by another.

## Causality classification

Do not treat “first noticed after operation X” as proof that X created the defect.

- **Created by stage**: the same issue predicate is false before and true after the operation.
- **Correction attempted, no change**: the correction checkpoint exists, geometry/decision output did not change, and skip/candidate/capacity data explain why it did not apply.
- **Correction applied**: geometry improves and the issue predicate becomes false.
- **Correction reverted**: a later event restores/worsens the prior geometry after a recorded correction.
- **Became observable later**: the structural condition existed earlier, but a needed measurement/element (such as the footnote area) did not exist yet.
- **Competing repair side effect**: another block/note/ornament/divider changed after the target appeared and altered available space or column balance.
- **Unresolved**: a needed checkpoint is absent, trace is truncated, the element cannot be matched, or the intermediate issue predicate is not evaluated.

For a causal claim, compare the target's state and all page deltas between the last known-good event and first bad event. If no intermediate predicate is available, add a checkpoint and predicate before declaring the cause.

## Issue-specific reading

- **Widow/orphan**: inspect token ID, continuation class (`p-cut`/`p-end`), visual line count/rectangles, split limits/candidates and the before/after state of `tryReclaimOrphanTail`.
- **Unbalanced columns**: inspect right/left heights, block outer height, chosen candidate/policy, split index/line count, capacity, fallback and rollback fields. A height difference is not automatically a defect when the block is one-sided or no legal split exists.
- **Page/block overflow**: compare page-relative bottoms, body-flow bottom, footnote-area top/height, and new/moved elements consuming space.
- **Sparse page/container gap**: compare visible body paragraphs, last text bottom, chapter boundary, note area and content shifted to the next page.
- **Footnote reflow**: compare body paragraph count, note-line count, note-area geometry and existing reflow queue metrics. The trace does not itself prove whether a particular note is legally splittable.
- **Heading/ornament/divider**: compare the geometry and existence/removal of each component against body-flow capacity.

## Tuning options

The CLI supports:

- `--step-audit-max-events <n>` (default 4000 events per page). Increase if `droppedEvents > 0`; a truncated trace cannot prove causality.
- `--step-audit-max-elements <n>` (default 1200 elements per snapshot). Increase if an element is absent from a delta; this increases run time and report size.
- `--step-audit-text-chars <n>` (default 180). Increase if the preview is too short to identify a text fragment.
- `--step-audit-no-line-rects`: omit line rectangles; do not use when diagnosing widow/orphan or sparse lines.
- `--step-audit-no-computed-style`: omit computed typography; do not use for font/line-height/alignment issues.
- `--step-audit-disabled`: performance comparison only; never use for a run intended to explain a finding.

The renderer also exposes `window.__stepByStepAudit.configure(options)`. The CLI applies its options before each render and clears the trace before a repeat render, so repeat-check output does not mix two render passes. Record exact flags/settings in the investigation notes.

## If the cause is still unknown

1. Check `traceComplete` and `droppedEvents`; raise event limits if needed.
2. If the target is missing, raise the element cap, verify page index/token ID, or extend the selector for a custom component.
3. Add a unique checkpoint immediately before and after the suspected mutating function. Prefer wrapping the full operation over scattered logging.
4. Increase text preview and retain line rectangles/computed style. Add missing decision attributes to the allowlist; avoid dumping all DOM attributes indiscriminately.
5. If the target's own geometry is stable, compare every sibling delta and page metrics. Look for a newly inserted note, ornament, divider, heading, moved paragraph or changed column membership.
6. To distinguish blocked correction from rollback, compare candidate counts, skip reasons, capacity, selected candidate and rollback reason before/after the attempted fix. “No geometry delta” alone is not proof that a fix was blocked.
7. Run a controlled counterfactual with one suspected operation disabled/restored, holding text and settings constant. Re-typeset the affected chapter diagnostically, then run the full `very_long_test_text.txt` regression.
8. If intermediate snapshots can evaluate the issue (one-line continuation, column-height difference, overflow), add a predicate at each checkpoint and emit `lastGoodStage`, `firstBadStage`, `correctionAttempted`, `correctionReverted`, and confidence. Do not infer a root cause from final geometry alone.

## Limits and safeguards

- This trace covers the named wrappers and current checkpoints, not every DOM mutation. If a function bypasses these points, instrument its mutation boundary.
- The issue reference says `candidate-window-only`; it does not fabricate an automatic causal verdict.
- If `droppedEvents > 0`, the trace is incomplete.
- Current CI has a separate open coverage finding: 17 pages in default settings and 18 with ornaments lack `.page-body-flow`. The accounting gate passes, but full container-gap geometry coverage is not complete.
- Full-document regression must always use `very_long_test_text.txt`. Chapter-isolated runs are diagnostic supplements, not replacements.
- Every tracing change must preserve deterministic final layout. The recorder must not modify page content, inline styles or layout decisions.

## Investigation record template

For every issue save: kind/severity; page index and printed label; token ID and preview; first appearance and candidate window; trace completeness; last known-good/first bad stage; attempted correction and rollback evidence; all sibling additions/removals/changes in the window; hypothesis and counterfactual result; remaining uncertainty.
