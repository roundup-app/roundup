# U86 icon/text audit

Baseline: `e84a1e7a2`. Dark Chromium, 1512×950, fixed `Date.now()`
1793304000000, fresh isolated browser profile. Paired captures live under
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
| todos/Todos done check/count/Clear done, OpenRow; pads/Pads | ShelfRow / KindGlyph / Icon | todo-summary-rail, wrapped-todos, todo-selected, pads-shelf |
| todos/TodoDrawer, TodoComments, TodoHistory, NewWorkstream, BlockerMenu | KindGlyph / Icon / shared controls | todo-drawer, todo-picker |
| ask/AskRows, AskBar, ToolCallLine; inbox/Inbox, InboxRow | KindGlyph / Icon | ask-history, all-kinds |
| ink/ErrorLine, ReservedLine; importer/ImportPanel; orders/WorkProgress | Icon / KindGlyph | conflict-failure |
| ui/Select, Combobox, Form, Checkbox, Disclosure, Menu | installed Ark / Lucide controls | settings-controls, settings-menu, todo-picker, rail-menu |
| shelf/Shelf, ScopeAction, BulkDelete; drawer/DrawerHost, DraftRecovery | Icon / shared controls | todo-summary-rail, todo-drawer, pads-shelf |
| header/Strip, ProjectTab; bubbles/Bubbles, Bubble; terminal/Pane | Icon / KindGlyph / shared flat tabs | project-tabs, floating-terminal |
| switcher/Switcher; changes/WorktreeControl; resources/ResourceStrip; app/Layout | shared Icon / KindGlyph | pending expanded observer |
| ink/OwnerMark | Icon | pads-shelf |

Standalone icon actions (IconButton, sortable grip, maximise/restore, close,
Todo Open and completion checkbox) retain their existing hit areas; they have
no adjacent label requiring a separate optical offset. EmptyState illustrations
and the running arc are artwork/motion, not font substitutes.

Optical acceptance is D12 policy. No test asserts layout. Existing vector/name/
shape proofs remain in ink/u86_vectors.test.tsx. The observer records rest,
hover, keyboard focus and selection plus visible rejected-call feedback.
