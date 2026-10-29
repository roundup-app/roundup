# U86 icon/text audit

Baseline: `387bbd6f2` (`origin/main`). Dark Chromium, 1512×950, injected clock origin
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
| ink/ErrorLine, ReservedLine; importer/ImportPanel; orders/WorkProgress | Icon / KindGlyph | conflict-failure, import-controls, work-progress-results, work-progress-control |
| ui/Select, Combobox, Form, Checkbox, Disclosure, Menu | installed Ark / Lucide controls | settings-controls, settings-menu, todo-picker, rail-menu |
| shelf/Shelf, ScopeAction, BulkDelete; drawer/DrawerHost, DraftRecovery | Icon / shared controls | todo-summary-rail, todo-drawer, pads-shelf, pad-drawer |
| header/Strip, ProjectTab; bubbles/Bubbles, Bubble; terminal/Pane | Icon / KindGlyph / shared flat tabs | project-tabs, floating-terminal |
| switcher/Switcher; changes/WorktreeControl; resources/ResourceStrip; app/Layout | shared Icon / KindGlyph | resources, worktree-trigger, switcher |
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

The observer also records hover and keyboard focus for each revealed icon-labelled
control in the Drawer, pickers, tabs, floating panels, import and Work progress.
`work-progress-results` opens the densest existing progress fixture and its earlier
results, showing older, accepted, checked, pending, unknown and unavailable marks.
Standalone icon buttons retain their existing 24 px hit area.

D8 retains the row-local horizontal inset check. Its old SVG-bottom/font-baseline
measurement is retired under U86; D12's x-height reading belongs to the critic.
The observer adds no geometry assertion and changes no product behaviour.

Validation on this branch: 62 U137/vector cases and 79 U6/U9/U15/U20/U80
cases pass. The main observer passes with 75 paired captures; supplementary
passes cover all ten Kind rows (including the unfolded done Agent) and the
nonempty Worktree trigger, for 108 paired views. Worktree capture supplies the
existing fake-Daemon changed-file response; it does not infer alignment from
an absent control. Check delta has no regressions. Appearance remains the
independent critic's decision, not a layout assertion.

The broad related run was stopped after two Shelf failures and one flaky pass;
all three cases pass directly with retries disabled after removing concurrent
load. CI's lanes judge the full suite. The source lint's missing blank line was
repaired and rechecked; its 164 fixtures passed unchanged.
