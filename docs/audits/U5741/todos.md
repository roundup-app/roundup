# U5741 Todo editing decision evidence

Audited main: `8ceee0830512da2835a7de61fb46967888e0bce5`. Documentation only; independent Todo controls continue the existing inventory. No owner choice, deletion or complete-inventory claim.

The observer is source reconciliation plus fresh isolated headless dark 1512×950 App openings using the existing fake-Daemon harness. Runtime role evidence remains pinned to its original revision. Native clipboard, real storage and vendor behavior are not established by a harness response.

## Decision boundary

Each independently removable control receives separate Q1 (existing equivalent), Q2 (no required journey action needs it), Q3 (information without an available action) evidence. Unverified is unresolved, never no. Existing acceptance and P6/P11/P12 remain effective. See the completed rows and limitations added by this run below.

## Sources and interpretation

Paths below are relative to `apps/desktop/src/` unless prefixed otherwise. `catalogues/todos-source.json` preserves inspected bytes, SHA-256, actual historical role replies and their original revision, current declaration lines, dated Issue replies, vendor help and the executed observer. `rendered-todos.json` preserves snapshots, visible text, calls, viewport, dark appearance and Checks. An opening proves only the control/state actually present in its retained snapshot.

Q1 compares the same action/result and states authority differences. G1 is the installed `gh issue edit --help`: title/body and GitHub account assignment resemble Todo edits, but GitHub Issue identity, remote authority and recipients differ from Project-local Todos and live roundup Agents. G2 is `gh issue comment --help`, which creates a remote GitHub comment rather than a Todo comment or roundup attention. G3 is `gh issue close --help`, which closes a remote Issue rather than completing a Project Todo. These command records and version are retained; the primary manuals are [edit](https://cli.github.com/manual/gh_issue_edit), [comment](https://cli.github.com/manual/gh_issue_comment) and [close](https://cli.github.com/manual/gh_issue_close). Similar operations do not establish an equivalent for roundup identity/authority. Broader Claude/macOS equivalents remain unverified where stated.

J1 is `.agents/data/journey.md`, What must work, Request: observe the actual Door action including its resulting Todo. J2 is Review: inspect that resulting work from its Workstream and reopen it. J3 is Intervene: reach the native Terminal and continue there. No requirement in these headings requires every optional Todo editing or inspection control. A Q2 yes marks that missing necessity even when another scenario explicitly requires the feature. It never retires that acceptance.

## Independent detail decisions

| Id | Feature / all inspected detail entry points; implementation; acceptance | Q1 equivalent | Q2 no required journey action needs it | Q3 information without an available action |
| --- | --- | --- | --- | --- |
| TD01 | Open/read current Todo; Shelf Open button, title activation; `TodoHost`, `TodoDrawer`, `Todos`; U17/U4698a | No: `todo.get`/Project identity is distinct from a remote Issue (G1) | No: J1/J2 need inspecting the resulting Todo | No: inspect title/body, edit, complete, comment or open linked work |
| TD02 | Previous Todo header button; `TodoHeader::go(-1)`; U4698d | Unverified: no vendor result pinned for neighboring Project Todos | Yes: J2 can inspect the selected result without sequential navigation | No: opens preceding id from retained order; disabled at first |
| TD03 | Next Todo header button; `TodoHeader::go(1)`; U4698d | Unverified: same limit as TD02 | Yes: next-result traversal is optional to J2 | No: opens following id; disabled at last |
| TD04 | Copy Todo id header chip; `TodoHeader`/`CopyButton`; U4698d | Unverified: macOS Copy exists, but no identical formatted `#id` action established | Yes: reading J2's result needs no id-copy | No: copies this Todo's identity for an explicit reference |
| TD05 | Project/title breadcrumb; `TodoHeader`; U4698d | No: G1's remote Issue identity is a different context | Yes: J2 requires correct identity, not this duplicate presentation | No: context lets the user verify the selected Project/Todo before mutation; breadcrumb itself has no activation |
| TD06 | Title in-place edit; double-click / focused Enter / title textarea; `EditableText::startWith`, `bind`; U445/U139/P11 | Unverified: G1 edits a remote title; no vendor edits this retained Todo identity | Yes: J1/J2 require creating/reading result, not renaming it | No: submit changed title; Enter commits, Escape retains draft |
| TD07 | Rich body edit / Add notes; `EditableText::RichBody`, `PadRichEditor`; U4698b/U3732/P11 | Unverified: G1 body editing has different authority; document formatting comparisons in pads.md remain separate | Yes: J2 needs readable result, not optional body authoring | No: edit source-backed notes; explicit submit/blur rules preserve destination |
| TD08 | Complete checkbox in detail, shared Shelf/Rail tick; `TodoMeta`, `TickBox`, `TodoDrawer::toggle`; U138/U152 | No: G3 closes a different remote object, not this Todo | Yes: J2 inspects work without requiring manual completion | No: `todo.complete` changes selected Todo; pending action retains accepted value |
| TD09 | Reopen done checkbox, same surfaces; `TodoDrawer::toggle`; U461a | Unverified: remote reopen is not proof of Project-local reopening | Yes: J2's Project reopen is distinct from reopening a done Todo | No: `todo.reopen` returns chosen Todo to open state |
| TD10 | Priority No priority; meta Priority menu; `TodoMeta`; U4698c/d | Unverified: G1's labels are not priority semantics | Yes: J1/J2 do not require clearing priority | No: `todo.update` with null clears priority |
| TD11 | Priority Low; same menu/component/acceptance | Unverified: same gap as TD10 | Yes: J1/J2 need no Low choice | No: selects low priority |
| TD12 | Priority Medium; same menu/component/acceptance | Unverified: same gap as TD10 | Yes: J1/J2 need no Medium choice | No: selects medium priority |
| TD13 | Priority High; same menu/component/acceptance | Unverified: same gap as TD10 | Yes: J1/J2 need no High choice | No: selects high priority |
| TD14 | Priority Urgent; same menu/component/acceptance | Unverified: same gap as TD10 | Yes: J1/J2 need no Urgent choice | No: selects urgent priority |
| TD15 | Assign current Todo; owner chip / More actions > Assign; `TodoHeader::assign`, `OwnerPicker`; U4698d/P6 | No: G1 assigns GitHub accounts, not a roundup Actor | Yes: J1 action can create its Todo without manual reassignment | No: `todo.assign` changes chosen owner, excluding current owner; disabled when done |
| TD16 | Hand to Agent; More actions; `TodoHeader` agentsOnly / `OwnerPicker`; U4698d | No: G1 does not assign a running roundup Agent | Yes: J3 uses native Terminal, not Todo reassignment | No: filters to eligible Agents and calls `todo.assign`; it is not a `todo.hand` call or authorization to start a process |
| TD17 | Move Home; More actions > Move · current Home; `TodoHeader`, `HomePicker`, `homesToOffer`; U4698d/P6 | No: remote Project membership in G1 is not a local Workstream Home | Yes: J2 needs finding correct existing Home, not moving it | No: `todo.move` chooses another Home, independent of owner |
| TD18 | Created-by context in More actions; `Menu.ItemGroupLabel`, `TodoHeader`; U4698d | No: remote author differs from this Todo's creator | Yes: J2 requires inspecting outcome, not this label | No: attribution supports deciding whether the chosen work is the intended result before acting; source-only label, not observed as a menuitem |
| TD19 | Delete Todo; More actions; `TodoDrawer` / `deleteTodos`; U3787a/P11 | Unverified: remote deletion is not same reversible local history/authority | Yes: J2 does not require deleting result | No: deletes only chosen id; region undo is separately catalogued in shelf.md |
| TD20 | Blocked by count/picker/add; meta button; `TodoMeta`, `BlockerMenu`, `changeBlockers`; U3728/U4698d | Unverified: no same local dependency/sequence comparison recorded | Yes: J1/J2 need no manual dependency authoring | No: count opens searchable eligible blockers; pick adds an edge using captured history |
| TD21 | Remove existing blocker; same picker/component/acceptance | Unverified: same local dependency gap | Yes: removing dependency not required by J1/J2 | No: selecting a checked related row removes that edge |
| TD22 | Blocking count/picker/add dependent; `TodoMeta` reverse direction; U4698d/U5644c | Unverified: same local dependency gap | Yes: J1/J2 need no reverse dependency authoring | No: pick changes target Todo's blockers to include the current id |
| TD23 | Remove dependent relation; same reverse picker/component/acceptance | Unverified: same local dependency gap | Yes: J1/J2 need no reverse edge removal | No: pick removes current id from chosen dependent's blockers |
| TD24 | History disclosure / read acknowledgement; Activity change-count line; `TodoComments`, `createTodoHistory`; U3728/U4698e | Unverified: remote history differs in storage, sequence and read authority | Yes: J2 reads current result without requiring its edit log | No: inspect actor/change before editing or deciding what changed; opening acknowledges only fetched history |
| TD25 | Copy Activity history; `createTodoHistory::copy`; U4698e/U5119 | Unverified: generic Copy is not proof of this JSON/history export | Yes: J2 requires inspecting result, not copying its log | No: copies lines, full history and failure for diagnosis/sharing |
| TD26 | Comment composer / Comment / Enter; Shift+Enter newline; `TodoComments::send`; U3741/U4698e/P11 | Unverified: G2 has different Todo recipient/attention semantics | Yes: J3 requires native Terminal continuation, not Todo comment reply | No: append exact draft to selected Todo; failed send retains text |
| TD27 | Reply under Agent comment; `TodoComments::renderComment`; U4698e | Unverified: no exact focus-to-local-recipient comparison | Yes: J3 native request does not use this composer | No: focuses the existing composer; no separate send/delivery path |
| TD28 | Agent status details fold; `partsOf`, `Collapsible`; U3775/U4698e | Unverified: no same status-marker/fold comparison | Yes: J2 does not need this comment encoding | No: selectively expands details to judge Agent's question; no model turn spent |
| TD29 | Older entries disclosure beyond recent twenty; `TodoComments::older`, `cutoff`; U4698e | Unverified: no equivalent exact cutoff/read boundary recorded | Yes: J2 current-result reading needs no long comment history | No: exposes older retained comments without erasing them |
| TD30 | Existing Pad ref / section open; `TodoRefs`, `refTarget`, `PadHost`; U3760/P12 | No: G1/G2 do not resolve a Project-scoped roundup Pad target | No: when linked Pad is the result, J2 needs opening that result | No: ok link opens recorded Pad and optional heading |
| TD31 | Missing Pad ref state; `TodoRefs` missing fallback; U3760/P12 | No: different Project/Pad identity from G1/G2 | No: J2/P12 require honest unavailable result rather than a substitute | No: Missing informs repair/removal; adjacent Remove acts on that same ref |
| TD32 | Remove Pad ref; adjacent Remove; `TodoRefs::remove`; U3760 | No: G1/G2 do not mutate these local refs | Yes: J2 can inspect retained linked work without unlinking it | No: `todo.removeRef` removes selected URL only |
| TD33 | Retry comments; comment load failure line; `TodoComments::refresh`; U3741/P11 | Unverified: no same read-state/recipient retry established | Yes: comment thread optional to native J3 path | No: retries this Todo's read; dismiss does not mark unread work read |
| TD34 | Retry history; history failure line; `createTodoHistory::refresh`; U3728 | Unverified: same sequence/read gap as TD24 | Yes: optional history need not be read for J2 | No: retries history fetch/read boundary |
| TD35 | Retry Pad refs; ref failure line; `TodoRefs::refresh`; U3760/P12 | No: same local-target gap as TD30 | No: when linked result cannot load, J2 needs retry or honest unavailability | No: retries current Todo's ref state |
| TD36 | Dismiss failure; originating title/body/comment/history/ref/draft lines; `ReservedLine` consumers; U5119 | Unverified: no exact scoped error-dismiss equivalent established | Yes: J2 requires actionable error, not optional dismissal | No: hides selected feedback; never discards submitted/draft work |
| TD37 | Copy retained Todo draft; `TodoDraftRecovery`/`CopyButton`; U2773/P11 | Unverified: generic clipboard is not exact retained-revision recovery | No: failed input in J1 and retained work in J2 must remain recoverable | No: copies explicit revision without replacing editor |
| TD38 | Discard retained Todo draft; `TodoDraftRecovery`; U2773/P11 | No: G1/G2 cannot discard local revision | Yes: J1/J2 preserve drafts without requiring discard | No: explicitly discards only selected revision |
| TD39 | Retry draft retention storage; `TodoDraftRecovery::problem`; U2773/P11 | No: remote Issue write does not retry local draft store | No: J1 requires failed input preservation; retention error needs recovery | No: retry retains recoverable in-memory text |
| TD40 | Save recovered title/body/blocker draft; `EditableText::save`, `TodoDrawer::saveBlockers`; U2773/P11 | No: G1/G2 cannot authorize this retained local revision/base | No: J1 failed input recovery needs explicit resubmission, never auto-send on restore | No: submits selected exact revision with captured base |

These are evidence rows, not an owner ballot. TD02–TD29, TD32–TD34, TD36 and TD38 have evidenced Q2 candidacy. Q1 unverified entries still require investigation before the final request. TD01/TD30/TD31/TD35/TD37/TD39/TD40 have recorded journey links; that does not override unresolved Q1 comparisons. Independently removable rich-body formats retain the Pad-format worklist, not one blanket editing disposition.

## Direction and regression boundary

- Reverses owner direction: 2026-10-12 — [#1204](https://github.com/roundup-app/roundup/issues/1204), explicit request for in-place Todo editing with retained type and size; TD06/TD07.
- Reverses owner direction: 2026-10-20 — [#3022](https://github.com/roundup-app/roundup/issues/3022), history only when requested and searchable blocker menu; TD20/TD24. This is acceptance for design, not evidence the owner no longer wants either feature.
- Reverses owner direction: 2026-10-21 — [#3192](https://github.com/roundup-app/roundup/issues/3192), owner explicitly chose Todo comments and Agent comments in Inbox until opened; TD26 and the comment-reading path. Its quoted direction also includes relating Pad sections and Todo ownership.
- [#4696](https://github.com/roundup-app/roundup/issues/4696), created 2026-10-28, and [#4697](https://github.com/roundup-app/roundup/issues/4697), created 2026-10-28, are preserved as header/meta and Activity work orders. Creation dates alone do not prove when every current clause was accepted. Exact dated priority/navigation/clipboard/recovery reversals remain unresolved.
- Search scope: the archived Todo scenarios, `PRINCIPLES.md`, `GLOSSARY.md`, journey, `docs/audits/U5741/direction.md`, `docs/wireframes.md`, `docs/design-system.md` and the five full Issue bodies/comments above. Orca/Paseo changed-file/diff/hint direction remains in direction.md; no Todo-specific reversal is inferred from those comparisons. Bise continuity is accepted P11/P12 direction dated 2026-10-19 in product-continuity.md, not blanket feature approval. No use telemetry or absent-use claim.

No representation changes. Before a selected deletion touches persisted Todo priority, owner/Home, blockers, Change snapshots, comments/read marks, refs, reversible deletion rows or retained drafts, inventory their actual old shapes and name behavior tests at `crates/todos/src/lib.rs::Todos::open` and the existing in-process Daemon storage seam. Successful older Project reopening with original identity and retained neighbors is mandatory. Refusal/reset and an isolated contract test cannot replace that observer; N5467 amendments belong in that same selected-retirement PR.

## Remaining coverage

Fresh openings cover only the retained snapshot states, not all conditional cases. Finish Todo capture/quick-add/native-capture/optimistic failure variants, triage and start-New-Workstream choices, loading/missing/deleted/pending states, long/older/Agent status comment variants, Pad ref missing/open/removal states, done-owner disabling, title/body conflicts and restored drafts. Separate row/key/menu variants still need current endpoint/role and configured-action reconciliation. Native clipboard and chooser effects are unproved. Finish exact vendor comparisons and remaining dated direction searches; reconcile this slice and all older evidence to one current main before the complete all-candidate owner request. Real Agent Terminals, Ask and native continuation remain protected; Overview stays excluded. #5758 stays open.

## Rendered coverage ledger

| Opening in rendered-todos.json | Rows evidenced and boundary |
| --- | --- |
| detail | TD01–TD08, TD10, TD15, TD20, TD22, TD24–TD26; current Todo body, actions and empty composer are visible; resting menus do not prove their items |
| priority | TD10–TD14; all five choices visibly offered, no priority mutation claimed |
| actions | TD15–TD19; Assign, Hand to Agent, Move · Project root and Delete Todo offered; creator is a source group label, not an actionable item |
| owners | TD15; actual role=menu Owners for #5 and owner choices; no assignment mutation claimed |
| homes | TD17; actual Home menu; no move mutation claimed |
| blocked-by | TD20; eligible forward relation choices; no added edge claimed |
| blocking | TD22; existing checked dependent and eligible choices support TD23's available removal action; no edge mutation claimed |
| history | TD24/TD25; aria-expanded=true asserted and actual `.todo-change` entries exposed; read call retained |
| title-editor | TD06; actual Title textarea visible after double-click; no title mutation claimed |
| comment-refused | TD26/TD36/TD37/TD38; injected rejection visibly names cause and next action; exact composer draft asserted retained; recovery controls must be read from the snapshot, not inferred from offscreen DOM |

TD09, TD21, TD27–TD35 and TD39/TD40 remain source-only conditional branches unless explicitly established by the table above. TD18's label is source-only. TD07's mounted body editor does not prove every library control. Captures do not establish clipboard success or real Daemon/storage actions. Q3 source reasoning on those rows remains an engineering assessment requiring the stated conditional renders before inventory completion; it is not claimed as a complete rendered observer.
