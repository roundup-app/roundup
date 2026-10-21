# Todos and Shelf component migration

Specification for #1609. Implementation owns `apps/desktop/src/todos/`,
`apps/desktop/src/shelf/`, their existing stylesheets and the `.todo*` and
`.shelf*` rules in `apps/desktop/src/styles.css`; it may edit only copy catalogue
entries consumed by those directories. It does not edit `ui/`, `keys/`, other
lanes, `tokens.css`, dependency manifests or lockfiles (policy).

The `u490a_`, `u491a_` and `u492a_` observers below are required implementation
acceptance, not tests claimed to exist in this specification PR. New behavioral
tests live in the owned directories and exercise real library components.

**U490a Todo reordering uses the shared Sortable.** Given three open Todos in
one Shelf list, including a blocked Todo, when the user moves the last before
the first by pointer, then `todo.reorder` is called once with that Todo's id
and the first Todo as `before`; after the Event/refetch the displayed order
agrees, no Drawer opened and focus remains on the moved row
(`u490a_pointer_reorders`). Cancellation and dropping in the original place
make no reorder call (`u490a_cancel_and_noop`). Ordering under an Agent remains
within that Agent's list, preserving other Todos' relative order and the
existing `before` translation (`u490a_nested_order_boundary`).

Given the same list with a row focused, when Alt+Up or Alt+Down moves it, then
exactly one reorder call is made, the refetched order changes and focus stays
on the moved row; moving past either boundary calls nothing
(`u490a_keyboard_reorders`).

Implementation composes `ui/Sortable`, deletes `todos/reorder.ts`, adds no
local drag engine and delegates drag interaction state to the primitive
(policy: diff inspection). U155 in `scenarios/ui-shelf.md`, heading “U155 the
user moves a Todo row up or down, by pointer and by keyboard”, keeps its call,
focus and cancellation rules; only its consumer-owned 4 px threshold is
superseded by the shared Sortable's activation behavior (policy). U156 in the
same file keeps its motion outcome; replace its computed-style-only unit test
with the rendered frame observer named there, retaining reduced-motion and
interruption coverage (`u490a_reorder_motion`). No new animation direction is
introduced (policy).

**U491a Shelf questions and navigation use library components.** Given two
selected Todos, when Delete opens the question, then a named `alertdialog`
shows both targets and initially focuses the keep action; Tab and Shift+Tab
stay within it (`u491a_bulk_question_focus`). Escape, keep and outside dismissal
each remove nothing and return focus to the connected opener
(`u491a_bulk_question_cancels`). Confirm deletes exactly the frozen selected
set once, preserves unselected Todos, and reconciles selection after readback;
a partial failure keeps the failed targets and visible failure text available
for retry (`u491a_bulk_delete_readback`). The shared BulkDelete path applies
the same question and failure behavior to two selected Pads
(`u491a_pad_bulk_delete`). Existing clear-done, selection lifetime and stale
context protection remain regression requirements (policy).

Given only keyboard use from the Shelf, when Tab, Space and Enter select two
Todos and confirm their deletion, then exactly those two disappear after
readback, the third remains and focus is on a connected Shelf control
(`u491a_tab_space_enter_bulk_deletes`). The test sends real browser key events;
it uses no pointer, programmatic focus or synthetic click after initial entry
(policy).

Given Todos and Pads tabs, when pointer activation or Left/Right and Home/End
navigation switches tabs, then exactly one tab is selected, each tab is linked
to its named tabpanel and Tab enters the selected panel; switching back keeps
the existing content and scope behavior (`u491a_shelf_tabs`). Compose shared
Ark Tabs; no local tab keyboard state machine (policy). U2744a replaces the scope toggle with Rail-derived scope (policy).

Every owned modal/confirm composes `ui/Dialog` or `ui/AlertDialog`, every menu
`ui/Menu`, every tooltip `ui/Tooltip`, and every icon-only button `ui/IconButton`
with an action `aria-label` (policy: diff and rendered role inspection).
Home selection remains reachable by keyboard, returns focus on dismissal and
shows failed moves without losing the existing Home (`u491a_home_menu`).
Every App-authored visible string uses `copy.ts`; authored titles, paths and
returned error text remain authored content (policy). Shortcut listeners move
to the existing `keys/` registry with component lifetime and scope; Ark owns
component navigation, dismissal and focus (`u491a_shortcut_scope`, showing the
Drawer/Shelf shortcut works once while mounted and stops after unmount).

**U492a migration preserves the rendered journey and budgets.** Given
`tree-40` with the Shelf and Todo Drawer, at 1512×950 in
light and dark for behavioral paths and dark only for captures and critic
Check readings (U3725), when the reorder, bulk-delete cancellation/success/failure, tab and Home
menu paths above run, then D2, D5 and D6 pass and no Check passing on the same
main baseline regresses (`u492a_rendered_checks`). D2 is the type/space Token
row, D5 the contrast row and D6 the target-state/size row of
`docs/design-system.md`, heading “The checks”. With U154's long-title/ten-blocker
seed, injected delete and move errors remain fully visible without overlap
or horizontal overflow (`u492a_dense_failure`). These observers preserve the
Review stage's work inspection and Intervene stage's actionable errors in
`.agents/data/journey.md`; a fake App seam proves webview behavior only
(policy).

Run in an isolated headless browser profile against `just harness`. Publish
paired before/after captures and Check readings as PR artifacts using
`artifacts/ux/U490a/`, `U491a/` and `U492a/`; never commit generated captures
(policy). Keep current Token names. Delete only CSS implementing interaction
state now owned by Ark; preserve required focus appearance (policy).

Every existing scenario carried by the owned directories still passes;
behavior tests use roles and accessible names. Remove tests of deleted custom
machinery and computed-style-only tests from every edited test file, naming
the retained behavioral proof or retired clause for each deletion in the PR
(policy, rule 10). U156's unit-style clause is replaced above, not silently
removed. `just check origin/main` passes (observer: that command). Rule 7's
cold-start <300 ms, keystroke-to-render p95 <16 ms, extra RSS for ten idle
Agents <150 MB and no measured regression above 10% still hold (observer:
`just perf`; keystroke-to-render in WKWebView is measured with
`just perf-keystroke` only when the user asks (`docs/perf.md`), never per PR);
record actual exits, head and baseline, never claim an unrun native result
(policy). A failed observer is an engineering failure, not a passing budget.

## Static observers

Run after implementation; each matching line is one failure row with its path
and line as printed by `rg`. These supplement the behavior observers.

| Command | Pass | Failure |
| --- | --- | --- |
| `rg -n ' title=|addEventListener\("keydown"' apps/desktop/src/todos apps/desktop/src/shelf --glob '!*test*'` | exit 1, no output | exit 0: each match; exit 2: observer failure |
| `rg -n THRESHOLD_PX apps/desktop/src/todos` | exit 1, no output | exit 0: each match; exit 2: observer failure |
| `test ! -e apps/desktop/src/todos/reorder.ts` | exit 0 | exit 1: custom reorder module remains |

## Prerequisites and reuse

Implementation waits for the merged implementation of Shelf reservation,
component foundation, copy catalogue, system font and registry, plus #1984's
shared Sortable and #1999's shared Tabs prerequisite. Track these as native Issue
dependencies; closing a specification alone does not satisfy them (policy).
#1852 is not planned: neither wait on it nor re-file it (policy).

Use existing shared components, not new lane machinery. Ark Solid Tabs is the
accepted UI direction: [Tabs](https://ark-ui.com/docs/components/tabs).
[Kobalte Tabs](https://kobalte.dev/docs/core/components/tabs/) also offers linked
panels, roving focus and manual activation, but adding a second component
system duplicates the installed Ark interaction layer; this lane cannot edit
dependency manifests. Sortable selection and alternative-library research
remain owned by U484 in `scenarios/ui-buttons.md`, heading “U484 shared Sortable delegates drag behaviour” and its
implementation #1984. No custom fallback is authorized (policy).
