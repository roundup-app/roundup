# U86 icon/text audit

Baseline: `e84a1e7a2`. Dark Chromium, 1512×950, injected clock origin
1793304000000 (elapsed time follows `performance.now()`), fresh isolated browser profile. Paired captures live under
`artifacts/ux/U86/{base,head}/`; images remain uncommitted.

The shared rule is `ink/styles.css`: inline SVG and Glyph boxes use
`vertical-align: middle` (the font's baseline minus half its x-height), and
flex/grid slots centre the same Token-sized boxes on their first text line.
Shelf titles use their existing 24 px first-line slot, including wrapped titles.
No SVG paths, Token values, horizontal columns or action targets change.

| Call sites (under apps/desktop/src) | Shared facility | Capture stems |
| --- | --- | --- |
| ink/SectionHead, shelf/OwnerGroups; rail/Rail headings | Icon / section-head | todo-summary-rail, all-kinds |
| rail/RailRow state/name, mode mark; Rail done fold and Overview | KindGlyph / Icon | todo-summary-rail, all-kinds, rail-selected |
| todos/Todos done check/count/Clear done, OpenRow; pads/Pads | ShelfRow / KindGlyph / Icon | todo-summary-rail, wrapped-todos, todo-selected, pads-shelf, pad-drawer |
| todos/TodoDrawer, TodoComments, TodoHistory, NewWorkstream, BlockerMenu | KindGlyph / Icon / shared controls | todo-drawer, wrapped-todo-drawer, todo-picker |
| ask/AskRows, AskBar, ToolCallLine; inbox/Inbox, InboxRow | KindGlyph / Icon | ask-history, all-kinds |
| ink/ErrorLine, ReservedLine; importer/ImportPanel; orders/WorkProgress | Icon / KindGlyph | conflict-failure, import-controls |
| ui/Select, Combobox, Form, Checkbox, Disclosure, Menu | installed Ark / Lucide controls | settings-controls, settings-menu, todo-picker, rail-menu |
| shelf/Shelf, ScopeAction, BulkDelete; drawer/DrawerHost, DraftRecovery | Icon / shared controls | todo-summary-rail, todo-drawer, pads-shelf, pad-drawer |
| header/Strip, ProjectTab; bubbles/Bubbles, Bubble; terminal/Pane | Icon / KindGlyph / shared flat tabs | project-tabs, floating-terminal |
| switcher/Switcher; changes/WorktreeControl; resources/ResourceStrip; app/Layout | shared Icon / KindGlyph | resources, worktree-control, switcher |
| ink/OwnerMark | Icon | pads-shelf, pad-drawer |

Standalone icon actions (IconButton, sortable grip, maximise/restore, close,
Todo Open and completion checkbox) retain their existing hit areas; they have
no adjacent label requiring a separate optical offset. EmptyState illustrations
and the running arc are artwork/motion, not font substitutes.

Optical acceptance is D12 policy. No test asserts layout. Existing vector/name/
shape proofs remain in ink/u86_vectors.test.tsx. The observer records rest,
hover, keyboard focus and selection plus visible rejected-call feedback.

The observer clears browser storage before each seed, so an earlier selection,
fold or settings change cannot replace a later baseline. `*-rest`, `*-hover`
and `*-focus` are explicit states for Todo summary/Rail, Todo rows, all Kinds,
Ask and the Rail menu; `todo-selected` and `rail-selected` retain selection.
The long Todo title wraps in `wrapped-todo-drawer`; the compact Shelf itself
retains its existing single-line truncation. `made-controls` and
`reaction-controls` cover further on-demand centre surfaces.

Validation: the existing 107 vector/name/shape and U6/U9/U15/U20/U80 behavioral
cases pass. Appearance is reviewed from the captures, not asserted by tests.

## Remaining verification

Observed UI source head: `c6eb6e5a06ff278747199ae968b0aca7a0dc3fab`;
`c5092c678` repairs only capture readiness.

The paired readings expose a D8/D10 conflict in Shelf-bearing views:
`testing/designChecks.ts`, `rowAlignmentCheck`, still rejects the painted
Glyph's bottom edge more than 1 px from the font baseline. U86 explicitly
supersedes that vertical clause with critic-only x-height centring; the
horizontal inset clause remains required. Resolve this obsolete vertical
observer under U86, retaining its inset check, and regenerate paired readings.
Do not restore per-surface compensation or claim the current delta passes.

The broad related-source run and final `just ready` were still running when
this report was written. The 107 focused behavioral proofs pass; those runs
and a complete independent optical inventory verdict are required before
closing #4922. WorkProgress result-state pairs and per-control state coverage
also need completing; existing conflict captures do not show those results.
