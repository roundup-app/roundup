# App feature audit

Specification for [#5741](https://github.com/roundup-app/roundup/issues/5741), mode `specify`. Source: the owner's 2026-11-02 request to audit the whole App for unused features, including features Agents already cover through monitoring. This specification defines the audit and the subsequent owner-authorized retirements; it claims neither an inventory nor a deletion has been delivered.

Journey: Enter, Request, Understand, Intervene and Review in `.agents/data/journey.md`, heading “What must work”. Terms use `GLOSSARY.md`; an audit row is a document row, not a new product object, RPC or setting.

**U5741 every offered feature gets an evidenced disposition.** Given the App, `rup` and MCP on the implementation's recorded `origin/main` revision, when the audit is performed, then the following acceptance holds. All clauses below are policy: the inventory, cited sources, rendered observations, owner's answers and implementation-head checks are the observers. Do not add a test that rereads this specification or checks report wording.

## Complete inventory

Policy: record the audited commit and an inventory in a linked Issue comment or linked checked-in report. Each row names one independently usable feature and its user-visible entry point, implementation file and function/component, owning scenario/Principle, available action and journey justification. A screen with independently removable sections has separate rows for those sections. A setting has its own row, including app-wide and Project settings, defaults and conditional choices. Include every menu entry, dialog, shortcut and its scope, not only top-level navigation.

Policy: enumerate all these surfaces, including conditional, empty, stopped, error and first-run states:

| Surface | Required coverage |
| --- | --- |
| App entry and navigation | First run, Project choice/open/close/reopen, Project tabs, Rail and row actions, Workstreams, Doors, Agents, Modes, switcher and requested centre views |
| Working and reviewing | Ask, native attention routes, Inbox, Terminals and their controls, Shelf, Todos and Drawer, Pads and editing, changed-file tree, diffs and line notes, outputs and links |
| Inspection and configuration | Resource inspection, work progress, history, notifications/alerts, App Settings and Project Settings, every section and individual setting, help and recovery surfaces |
| Native and keyboard entry points | App, Project, Edit and other native menus, context menus, confirmations/dialogs, chord catalogue, leader keys, local bindings and named actions, including actions available only in particular states |
| `rup` | Every leaf command and explicit top-level command, help/discovery, stream commands and `actions`/`do`; record role restrictions and the method/action reached |
| MCP | Actual `tools/list` for an Agent and a Door, including Door-only tools, mapped to method and input schema; distinguish CLI-only commands and methods deliberately not offered as tools |

Policy: this table is a coverage checklist, not a claim every named surface still exists. Check the implementation revision; mark already-removed entries absent with their removal evidence. Reconcile the inventory against all production App surface modules and entry-point registries, the native menu builder and context-menu models, App and Project settings fields, local key registrations, CLI help/dispatch and both MCP role lists. List inspected files and unmatched entries; every unmatched entry must be resolved to a row or an evidenced non-product/test-only exclusion before the audit is complete. A static search alone does not prove an entry is reachable or absent. Use the existing isolated App harness to open the reachable screens, menus, dialogs and settings, and the existing public CLI/MCP observers to enumerate their actual offers; retain results and command failures with the audited revision.

Policy: one operation exposed in several places may share a decision row only if the owner can keep/delete it as one feature. Its inventory must still enumerate every entry point, command and tool by exact name. Do not hide an independently removable control in a broad “Settings” or “Agent management” row.

## Candidate rule

Policy: for each in-scope row answer all three questions. Any yes makes it a candidate; a candidate is not permission to delete. “Unused” does not mean measured non-use: no usage telemetry or owner usage history is assumed.

1. Does Claude Code, Codex, macOS or `gh` already provide the same user action or result? Cite the existing roundup implementation and a versioned command/help result or primary vendor documentation for the equivalent operation; explain differences in scope or authority. Similar names alone are not evidence. A future unimplemented Adapter is not a current replacement.
2. Is there no required action or result in any of the five journey stages that needs this feature? Cite the journey heading and state the missing connection. A claimed need must name the stage, its required action/result and why the retained path needs this feature; merely saying “Review” is insufficient. A feature outside the journey remains a candidate even if another scenario requires it.
3. Does this surface show a record or setting without an action the user can take on or because of that information? Cite the rendered state and its implementation, list any available action, and explain why none acts on that information. Inspection that supports a concrete decision must be described, not automatically treated as inert.

Policy: record yes/no and evidence for all three, including non-candidates. An unresolved claim is marked unverified and investigated, never silently counted as no. Resolve engineering gaps before presenting the complete candidate list. An unreachable implementation is recorded separately from an offered feature; do not invent an owner usage claim for it.

Policy: The Overview list (#5730) is excluded from candidate decisions and deletion work here; list it only as an exclusion with its owning Issue. Real Agent Terminals and the Ask are always retained and never candidates, including their direct access and native request continuation. This protection does not exempt independently removable inspection/settings beside them from the inventory. Do not move excluded work into a different row to retire it indirectly.

## One owner decision request

Policy: put every candidate in one `ask`, divided into consecutively numbered batches of at most ten candidate rows. No sampling, early batch sent while later features remain unaudited, or default deletion. Each row has a stable report identifier, feature and affected entry points, the applicable candidate reasons with cited evidence, and the literal choice `keep / delete`. Link the complete inventory and audited revision. Include all candidates even when the auditor recommends keeping them. The owner can choose differently for independent features; combine rows only under the inventory grouping rule above.

Policy: search recorded direction in scenarios, Principles, design documents and linked owner Issues/comments for each candidate. Mark a reversal as `Reverses owner direction: <date> — <source and accepted outcome>`, explicitly including Orca, Paseo and Bise comparisons when present. A vendor comparison or background note alone is not an accepted direction. If no dated direction is found, name the sources searched; never manufacture a date or interpret absent evidence as owner approval. Existing scenario requirements stay effective until the owner authorizes their retirement.

Policy: the answer record maps every candidate identifier to keep or delete and cites the owner's reply. Missing or ambiguous choices remain undecided; do not infer permission from silence or elapsed time. Resolve only the remaining product choices through the same work Issue. A keep retains the feature and its acceptance. A delete retires exactly the selected feature across all entry points and callers, without a replacement unless the owner requested one.

## Atomic retirement and regressions

Policy: before each deletion, add its exact retirement to this specification and amend the owning scenarios and affected Principles in the same implementation PR. Name the retired then-clauses and map every removed test to its retired clause or the surviving test that proves it. Retain unrelated clauses and proofs. Remove the selected feature from product code, copy, settings, menus, keys, named actions, `rup`, MCP, Rust contract declarations and regenerated bindings together wherever it is offered; remove exclusive storage/readers and dead helpers. No aliases, hidden flags, v2 interface, compatibility endpoint or ghost menu entry keeps a deleted feature offered. Shared code and data needed by kept features remain.

Policy: record a per-feature caller inventory and post-deletion search over exact symbols, method/tool/command names, labels and scenario/Principle requirements. Classify each surviving match: a retained feature, explicit retirement record or historical evidence may remain; an executable implementation, offer, active acceptance clause or Principle requiring the deleted feature fails completion. Probe removed public CLI/MCP/RPC entry points for their normal unknown-command/tool/method refusal and retained neighboring operations for success. Select the existing highest public seam and name the behavior tests in the retirement amendment before implementing it; no source-text deletion tests.

Policy: rule 4 applies to every changed contract and caller. Message/Route/Held/Takeover changes preserve the applicable M1–M10 laws and their existing proofs. No deletion changes or deletes user work beyond the owner's selected retirement. Keep current Project identities, retained work, permissions, drafts and native Terminal ownership. Changes to visible surfaces meet the journey's rendered observer and D2/D5/D6 at 1512×950 in dark mode, with actionable failure text visible on the densest seed; retain captures under `artifacts/ux/U5741/` uncommitted.

Policy: every deletion opens owner Projects with older data (#5741), preserving Project identities and retained work across the retirement. Record the affected pre-deletion data shapes and name behavior tests at the existing store-open and real in-process Daemon seams before implementation. Those tests open Projects containing those older representations after the deletion and assert the same Project identities and retained work; refusal or reset does not satisfy this regression. When a selected deletion affects persisted representations, amend `scenarios/local-data-retirement.md`, N5467a/b and any affected N5467 clauses in the same implementation PR to require these successful opens and retire their contradictory refusal/no-reader clauses for those representations. Map removed tests to the amended clauses or surviving proofs. The work order already requires reopening; do not ask the owner to choose refusal/reset instead. Preserve unrelated refusal protections and fresh/current reopen safety.

## Delivery and completion

Policy: the specification PR contains this acceptance and links a dependent implementation Issue natively blocked by #5741; it may close #5741 when the specification acceptance is reviewed and merged. It does not close implementation or claim the audit has run. The implementation Issue owns the complete inventory, owner `ask`, answer record and selected retirements. Progress and engineering questions stay on that Issue, never in scenario Work tables.

Policy: when rule 3 requires multiple deletion PRs, file bounded child work Issues, each natively blocked by the one before it, and link their preserved acceptance to the implementation Issue. Each slice keeps callers atomic; do not split a contract from its callers. No speculative deletion Issue assumes a missing owner choice. The implementation stays open until the inventory is complete, every candidate has an owner disposition, all chosen retirements have merged and the final absence/older-data/current-data observers pass.

Policy: run `just ready` and changed/named behavior test files for code slices. CI's successful `check` on each implementation head supplies the requested `just check` observer; the Builder runs no local `just check`. Report each failed command as its own Issue row with command, failure and exit code. A failed or unavailable observer is not a pass. No Mac-only observation is needed for this specification or the documentary audit; request one only for a subsequent behavior no existing Linux/Chromium/CI observer can establish.

## Checks on main

These numbered checks are source anchors, not claims the audit already passes. Recheck them on the implementation base.

1. `apps/desktop/src/app/Layout.tsx`, `Layout`, and `apps/desktop/src/terminal/Pane.tsx`, `Pane`: production App composition and requested centre views.
2. `apps/desktop/src/settings/AppSettings.tsx`, `AppSettings`, and `apps/desktop/src/rail/ProjectSettings.tsx`, `ProjectSettingsView`: settings surfaces, including individual conditional fields.
3. `apps/desktop/src/keys/chords.ts`, `CHORDS`, `LEADER`, `ACTION_ROWS`; `apps/desktop/src/keys/registry.ts`, `registerKeys` and `captureEvery`; `crates/desktop/src/menu.rs`, `app_menu`: keyboard/named actions and native menu entries.
4. `crates/rup/src/cli/help.rs`, `help_text`; `crates/rup/src/cli/actions.rs`, `command`; `crates/rup/src/mcp.rs`, `tools`: explicit CLI commands and role-dependent shared tool catalogue. `crates/rup/tests/cli/tool_catalogue.rs`, `i1_every_mcp_tool_is_a_command_and_no_command_is_extra`: catalogue parity.
5. `crates/rup/tests/mcp/tool_lists.rs`, `m5_every_app_action_has_a_tool_or_a_reason`; `scenarios/mcp.md`, M5: tool/no-tool authority inventory. The audit does not grant an Agent new authority.
6. `.agents/data/journey.md`, “What must work”; `PRINCIPLES.md`, P1/P3/P6/P9/P11/P12: required journey, direct access, attention, work ownership, intentional Agent turns, drafts and deliverables. Their Gates apply to each retirement's changed paths; the audit grants no blanket waiver.
7. `scenarios/ui-worktree-changes.md`, U2539a–d, and `scenarios/ui-shortcut-hints.md`, heading “UI: shortcut hints (U2230 to U2230b, U2541 to U2541e, U2570a to U2570c, U5247 to U5247b)”: dated Orca comparison direction; `scenarios/product-continuity.md`, heading “Owner direction — 2026-10-19 (Europe/London)”: distinguish accepted owner outcomes from Bise background. Search beyond these anchors for Paseo and further direction.
8. `scenarios/local-data-retirement.md`, N5467a–d: the refusal/no-reader clauses affected deletion PRs must amend to require older-Project reopening, retaining unrelated current/fresh safety.

Policy: specification validation is `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`, each exit 0, plus verification that these file/symbol/heading anchors exist on `origin/main`. Review verifies coverage against #5741; a green vocabulary check alone does not demonstrate acceptance.

## Retirements

Policy: the owner's 2026-11-04 picks (#5758) retire one feature per PR. **P11 Copy Project metadata** is retired: a Project tab's menu offers Rename, Alerts (U6220d) and Close. Retired then-clauses: the Copy clause of U3299d for a Project (`scenarios/ui-visual.md`) and U2694a's Copy row for a Project tab. Removed tests: `u3299d_copy_uses_selected_item_project` (retired clause) and `p3557c_failure_lifetime_header_menu_%s` (its failure source is the menu Copy; `p3557c_failure_lifetime_header_retention_%s` and the `u475_browser` header capture still prove the failure lifetime through the recovery dialog's Copy name). `u2694a_each_object_builds_its_items` asserts the two remaining items. No stored data changes, so older Projects open unchanged.
