# Rail tree spike (U6633a, #6633)

**Verdict: keep Ark.** An Ark-free Rail tree drops in a median 35 ms against Ark's 150 ms, but no variant reaches one 16.7 ms frame, and the prototype fails 22 of the 94 Rail keyboard, role and drag tests. The bar needs all three, so the drop time decides: the cost left after Ark's work is gone is the app's own redraw, not Ark.

## Measure

Head: `main` at `76b1d37bb`, headless Chromium 156.0.8078.80 on a fresh profile, `tree-40` at 1512×950 (`harness.html?view=workstreams&items=1&tabs=1&seed=tree-40`). A drop is `tokens` below `logins` and back, by real pointer events. CDP `Tracing` records the longest `RunTask` within 400 ms of `pointerup`. Two runs of 10 drops each, so 20 drops per variant, in ms:

| Variant | min | median | max |
|---|---|---|---|
| A. Ark as on `main` | 27.6 | 150.4 | 178.8 |
| A′. `main` plus #6568's narrowing (`8a69c62ee`: `movedTo`, `KindGlyph`, one batched redraw; its source diff applies to `main` unchanged) | 58.1 | 143.9 | 161.8 |
| B. A′ plus the Rail collection kept across a move (signature ignores order) | 88.8 | 118.0 | 158.1 |
| C. Ark-free prototype (B plus the shim below) | 26.6 | 35.5 | 60.6 |

A is bimodal (about 30 to 60 ms or 150 to 180 ms); CI's `U3800g` numbers (77 to 288 ms) are the same shape on a slower runner. Ark with a stable collection (B) is not under 16.7 ms, so the prototype was built.

A CPU profile over the same window puts self time in Ark and zag frames at 1 to 15 ms per drop for B. Solid's reactive graph, `HTMLElement.focus` (20 to 33 ms) and layout carry the rest. The Ark-free prototype removes the per-row props work and still takes 35 ms, so the remaining tasks are not Ark's.

## Prototype

Branch `spike/rail-tree-ark-free` (commit `d2a419061`), never merged. `apps/desktop/src/ui/TreeView.tsx` is replaced by a shim with Ark's part names that renders plain elements with `role`, `aria-level`, `aria-expanded` and `hidden`. It has no keyboard walk, typeahead or focus management, so its drop time is a lower bound for an Ark-free Rail: a real one adds that work back.

## Libraries compared (rule 9)

| Candidate | Source | Latest release | What it lacks |
|---|---|---|---|
| `@headless-tree/core` | github.com/lukasbach/headless-tree | 1.8.0, 2026-10-25 | A Solid binding: rows and roving focus would be wired by hand, and its own drag feature duplicates `@dnd-kit` (`ui/sortable.tsx`). |
| `@zag-js/tree-view` | github.com/chakra-ui/zag | 1.47.0, 2026-10-26 | Nothing against Ark: it is Ark's engine, so it keeps the same per-row props recompute. |
| `react-arborist` | github.com/jameskerr/react-arborist | 4.0.1, 2026-10-11 | Solid: it needs React, `react-dnd` and `react-dom`. |
| Custom code | the shim above | n/a | Keyboard walk, typeahead and focus, all rewritten and re-tested. |

Ark itself (`@ark-ui/solid` 5.40.0, 2026-10-29) is current and maintained.

## Ark `TreeView` behaviour the Rail uses

- Keyboard walk: arrows through `collection`, `focusedValue` and `onFocusChange` (`Rail.tsx`), skipping nodes `isNodeDisabled` marks hidden or inert.
- Typeahead: by `nodeToString`, which is each row's name.
- Roles and levels: `tree`, `treeitem`, `group`, `aria-level` and `aria-expanded` from `Tree`, `Branch`, `Item` and `NodeProvider` with an `indexPath`.
- Focus: roving `tabindex`, and `BranchControl` and `Item` through `asChild` onto the Rail's own row.
- Expand state: `expandedValue` and `onExpandedChange`, mapped onto sections, folds and Workstreams.
- Selection: `selectedValue` from the Rail's selection.

## Tests against the prototype

13 Rail files (keyboard, tree walk, semantics, drag, move, lifted fold, browser drag), 94 tests, all pass on `main`. On the prototype 22 fail: `u31_rail_keyboard` 11, `u520_tree_walk` 5, `u520_semantics` 2 (`u520_axe_clean` among them), `u6550a_lifted_workstream_folds_its_children` 1, `u4547a_rendered_heading_keys_preserve_focus_without_calls` 1, `u4547e_drag_reparents_the_chosen_agent_without_restarting` 1 and `u6550d_escape_after_a_pointer_lift_slides_each_row_once` 1. `u522_browser` passes all 11. Most failures are the keyboard behaviour the shim leaves out.

## Startup size

Production build, the entry `index.html` loads (62 chunks on `main`, 60 on the prototype):

| | raw | gzip |
|---|---|---|
| `main` | 1,372,814 B | 451,417 B |
| prototype | 1,348,143 B | 444,328 B |

The prototype is 24.7 KB raw (1.8%) and 7.1 KB gzip smaller. That is less than Ark's whole share, since Rail, Todos and Shelf still import its collection helper and the other `TreeView` users still need its behaviour.

## Bar

| Condition | Result |
|---|---|
| Drop under 16.7 ms | no, median 35.5 ms |
| Every Rail keyboard, role and drag test passes | no, 22 of 94 fail |
| Entry no larger than `main`'s | yes, 1.8% smaller |

Rebuild only if all three hold, so Ark stays. The next cut at the drop belongs to the redraw itself (Solid updates, `focus`, the `scrollHover` rescan), not the tree library.
