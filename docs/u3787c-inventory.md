# U3787c mounted inventory

The production App owns these content collections. Tests below assert behavior in their bodies; filenames alone are not completion evidence. Paths are relative to `apps/desktop/src/`.

| Collection | Production opening | Navigation / selection proof |
| --- | --- | --- |
| Shelf Todos and Pads | Work items (⌘K, S), tab, owner disclosure | `shelf/u3787c_selection.test.tsx`: `u3787c_each_list_navigates_visible_rows`, `u3787c_each_list_selects_only_visible_rows`, `u3787c_name_prefix_precedes_commands` |
| Shelf owner group | Agent counted Pads/Todos control | `testing/u3787c_inventory.test.tsx`: owner-control variants of both list tests; `rail/pads/u4457_pads_control.test.tsx` proves folded ancestors, finished Todos and original Project/selection |
| Rail Workstreams and Agents | Project menu → Workstreams; parent disclosure for nested Agents | `testing/u3787c_inventory.test.tsx`: App Rail navigation and selection; `rail/u3787c_lists.test.tsx`: no-anchor range, folded/hidden/disabled exclusion; `rail/u3787c_browser.test.ts`: dense App selection |
| Switcher content results | ⌘K, K; search results after query | `switcher/u3787c_lists.test.tsx`: both list tests, chosen Terminal activation, filter/reopen lifetime and native query Home/End |
| Inbox Agents and unread comments | ⌘K, I; rendered groups | `inbox/u3787c_lists.test.tsx`: both list tests, Agent/Comment activation, reopening lifetime and copy |
| Import candidates | Project menu → Import Claude Code work; retained choices | `importer/u3787c_lists.test.tsx`: both list tests, candidate activation and page lifetime |
| Changed files | Select Agent with Worktree → counted changed-files control, or Review changes (⌘K, C) | `testing/u3787c_inventory.test.tsx`: both App list tests for both openings; `changes/u2539b_library.test.tsx`: vanilla typeahead/range/input ownership |
| Overview entries | Open Project → Needs you; Project menu → Workstreams overview | `ask/u3787c_lists.test.tsx`: both list tests, original attention activation and lifetime |
| Made | Project menu → Made | `ask/u3787c_lists.test.tsx`: both list tests, original publication identity and lifetime |
| Named reactions | Project menu → Named reactions → saved list; return from detail | `reactions/nr9_reactions.test.tsx`: both list tests, exact reaction activation, lifetime and form key ownership |

Rail Pad/Todo leaves were retired by #4457. Their counted owner control opens the actual Shelf group; no duplicate Rail collection is added. Current standalone Terminals use Terminal tabs, not a separate Rail content collection (`testing/nodes.ts`'s historical `terminal` fixture now makes an Agent without Status).

| Rename | Actual opening | Escape and recovery proof |
| --- | --- | --- |
| Shelf Todo / user-owned Pad | Focus row → F2; double-click | `testing/u3787c_inventory.test.tsx`: `u3787c_escape_restores_the_name App` compares saved display, current row focus, zero rename/Terminal writes, consumed underlying Escape and exact retained Unicode/whitespace |
| Rail Agent / Workstream with Door | Native context-menu Rename where offered; focused row → F2 or double-click | `testing/u3787c_inventory.test.tsx`: native Rename; `rail/u3787c_lists.test.tsx`: F2/double-click, exact drafts and consumed Escape. A Workstream without a Door offers no native Rename item |
| Project tab | Focused F2, double-click name, native Rename | `header/u183_rename.test.tsx`: `u3787c_escape_restores_the_name_project`, plus conflict/failure and selected-revision recovery |
| Terminal tab | Double-click, native Rename, selected-revision recovery | `bubbles/u511a_rename.test.tsx`: `u3787c_escape_restores_the_name_terminal`, `u3787c_escape_restores_the_name_selected_terminal_recovery`; `bubbles/u511a_browser.test.ts`: dense App openings, underlying Escape and zero local name writes |

Agent-owned Pad names retain their ownership restriction. `pads/u3789a_pad_rename.test.tsx` preserves exact text through refetch without submitting; `shelf/u3789_rows.test.tsx` retains reload, older-failure/newer-draft and navigation probes. `header/u183_rename.test.tsx`'s `u3787c_escape_restores_the_name_project_%s` proves mounted App-seam restoration after remount: exact Unicode/whitespace, selection and original Project identity persist, with zero rename calls; it does not cover real-Daemon reload. `bubbles/u511a_browser.test.ts`'s `u2773a_bubbles_real_project_reload_and_u2773c_ended_original_recovery` retains its real-Project restoration observer. Explicit discard and acknowledged-submit settlement remain with the original Project draft holders.

| Optional surface | Classification / retained observer |
| --- | --- |
| Project / Terminal tabs | Native/library tab semantics; `header/u184_close.test.tsx`, `bubbles/u511a_rename.test.tsx` |
| Form pickers / action menus | Single-value/native command semantics; `ui/Combobox.tsx`, `ui/contextMenu.ts`, `switcher/u2572_actions.test.tsx` |
| Ask history, revisions, reaction firing history | Read-only records, not independently opened content objects; `ask/AskRows.tsx`, `todos/u462_history.test.tsx`, `reactions/nr9_reactions.test.tsx` |
| Work progress report | Report prose with explicit evidence links; existing progress observers |
| Resource summaries / Terminal output | Read-only measurements / vendor-owned input and output; `resources/u408_strip.test.tsx`, Terminal typing observers |

Gates: P3/P9 forbid attention or starts from selection; P6/P11 preserve original identities, exact drafts, recovery and Terminal input ownership; P14 forbids usage/cost data. Observers assert focus, selection, call counts and contracts. Rendered captures judge D2/D5/D6/D9; behavioral tests make no layout assertions. All keyboard/pointer feedback remains instant, using existing Tokens and controls.

The final App inventory has 18 behavioral cases. The retained P11 observer repair
merged in [#4741](https://github.com/roundup-app/roundup/pull/4741), completing
[#4733](https://github.com/roundup-app/roundup/issues/4733). NameField uses Ark's
`selectOnFocus={false}` because its existing draft holder restores the selection;
Ark's deferred select-all must not overwrite that range.

| Retained acceptance | Behavioral observer |
| --- | --- |
| Exact Todo/Pad draft, selection and original object after reload; no rename/read/history from restoration | `shelf/u3789_rows.test.tsx`: `u3789a_rename_never_opens_reload_keeps_original_identity`, parameterized over Todo and Pad |
| Late reaction acknowledgement stays in its original Project and preserves newer input | `reactions/nr9_reactions.test.tsx`: `nr9_creation_acknowledgement_refreshes_the_remounted_project` |
| Mounted App-seam Project-name restoration after remount: exact Unicode/whitespace, selection and original Project identity, with zero rename calls; no real-Daemon reload coverage | `header/u183_rename.test.tsx`: `u3787c_escape_restores_the_name_project_%s` |
| Real Terminal-name restoration, exact selection and refusal to rename an ended original | `bubbles/u511a_browser.test.ts`: `u2773a_bubbles_real_project_reload_and_u2773c_ended_original_recovery` |

The repair's [check run](https://github.com/roundup-app/roundup/actions/runs/40800954408)
passed all six web lanes and Chromium. Its
[Issue evidence](https://github.com/roundup-app/roundup/issues/4733#issuecomment-6485381820)
records passing real-Terminal restoration and six dark 1512×950 Rail/Shelf captures
on tree-40, tabs-8 and conflict, including visible failure text and D2/D5/D6/D9.
Earlier observer failures remain recorded there; they are not acceptance passes.
This inventory completes the bounded list/rename work of #4306, subject to its
completion PR's required checks and independent review. #3843 remains open.

Completion validation on 2026-10-29, including main `618cb1169`: the combined
17-file inventory, activation and P11 recovery suite passed all 395 tests
(`vitest run`, two workers, no retries). This includes all 18 final App inventory
cases and the real-Project header observer. The real-Terminal reload/ended-original
observer passed separately with one worker and no retries. Existing native evidence
is retained: [check 40716930383](https://github.com/roundup-app/roundup/actions/runs/40716930383)
passed `mac` and `mac-clippy`; the user reports what they meet on the Mac.
