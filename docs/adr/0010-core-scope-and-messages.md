# Core scope and Messages

Assessment for [#1621](https://github.com/saadshahd/roundup/issues/1621), against main `d5ada596c225f6d55376913d71f033b84200f547` (2026-10-14). Keep the Door, blocked-only attention and usage discipline. Simplify Messages internally while retaining its laws; remove the superseded Workstream presentation through its existing owner; defer new visual authoring and Workstream expansion. This ADR changes no implementation, contract, law or glossary term.

The [first journey](../../.agents/data/journey.md) has J14 real-Daemon/fake-Claude evidence for Enter → Request → Understand → Intervene → Review, at two viewports on one revision. That is narrower than a polished native App or real-Claude acceptance. The owner's later [terminal direction](../../scenarios/door-terminal.md) replaces the Thread and composer with the Door's primary Terminal, preserves child Takeover and Checkpoints, and sends child attention to its own Terminal. Complete that migration and its observer rather than expand the old presentation. The historical “minimally functional, not polished” assessment in [wireframes](../wireframes.md) is not a current failing-test result.

## Messages

### What the laws buy

The laws check a one-receiver Bend model, not Rust, SQLite, the Terminal or all Daemon interleavings. V4 public-seam invariant replays connect model and implementation; Historical V3/V5 mutation checks demonstrate rejection of specified bad transitions; V7 constrains law changes and model agreement. Current mutation coverage has the maintenance failures recorded below. “Caught” below separates an observed defect from an intentionally injected mutant. There is no evidence that every law independently discovered a production bug.

| Law | User protection | Recorded evidence | What a status-only FIFO would lose without additional rules |
|---|---|---|---|
| M1: at most once | A repeated delivery cannot start the same work twice or charge another turn. | [#634](https://github.com/saadshahd/roundup/pull/634) rejects a mutant that delivers an id without checking its hold; not a reported production incident. | A durable delivery cut and conditional claims; ordinary retry after Terminal ambiguity violates this protection. |
| M2: retired | Retired by #3563 with ask-first Routes and Message holds; no obligation replaces it. | — | — |
| M3: retired | Retired by #3563 with Takeover and unsent-input holds; Messages reach an Agent through its Claude inbox and write nothing to Terminal input. | — | — |
| M4: ordering | Ready work retains its order; one pending item cannot indefinitely obstruct later eligible work (B7). | #634's mutant prepends instead of appending typed ids. The proved law is only typed-prefix growth: it does **not** prove B7 tie order or that one Message never blocks another. No independent historical ordering bug is established. | Eligibility rank and id tie-break, with raw FIFO head blocking is wrong. |
| M5: final-state separation | The user does not see one Message both completed and dropped/waiting. B8 additionally requires final states never revive. | #634 rejects a mutant dropping an id without checking it is held. This is mutation evidence. The law body proves disjointness, not full temporal absorption or monotonic allocation by itself. | Guarded final transitions and never requeueing a final row; a status column alone does not enforce these. |
| M6: conservation | Every accepted Message remains inspectable as pending, delivered or dropped with a reason. | #634's mutant forgets pending ids at exit. [#598](https://github.com/saadshahd/roundup/pull/598) repairs operation failure recovery/rollback; [#1256](https://github.com/saadshahd/roundup/pull/1256) fixes unsent Digest loss while a Door is stopped. Those integration defects were not discovered by the conservation proof. | Durable records, transaction rollback, retained Digest weights and explicit dropped reasons instead of deleting consumed jobs. |
| M7: receiver ending | Work is not injected into a gone or wrong Attempt of an Agent. | #634 rejects a mutant sending after permanent receiver loss. [#741](https://github.com/saadshahd/roundup/pull/741) supplies a resumed-Door acceptance regression without a production change. The permanent-gone model does not prove Attempt restart fencing; B36/lifecycle tests do. | Attempt and Status-revision fences, final ending reconciliation and a distinction between temporary restart and removal. |
| M8: retired | A question is one ordinary Message; nothing passes it on (`scenarios/remove-bubbling.md`). | Retired with the bubbling chain by #3692; no law stands in its place. | None: no hop, timer or held question remains. |
| M9: replay | Reopen does not repeat delivered work or leave stale in-memory state after a lost-Terminal restart. | **Real model/step gap:** #747's M9 test found stale in-memory state after a lost-Terminal restart and corrected both. Its restart mutant also fails. [#1367](https://github.com/saadshahd/roundup/pull/1367) and [#1393](https://github.com/saadshahd/roundup/pull/1393) add explicit restart/retirement preservation, not general exactly-once execution. | Stored ownership/order/id replay, reservation tombstones and no typing during recovery; no in-memory state outlives a restart. |
| M10: progress under fairness | Accepted pending work reaches an eligible idle Agent instead of silently waiting forever. | #634's mutant retains an item after typing. **Real delivery defect:** [#425](https://github.com/saadshahd/roundup/pull/425) regresses already-idle send, hold release and idle ancestor delivery repaired in #422. Integration tests caught it, not the fuel proof. | An idle-send/release wakeup and eventual scheduling after Takeover/input end; status storage alone schedules nothing. |

Read the exact statements in [LAWS.bend](../../proofs/messages/LAWS.bend), coverage limits in [proof scenarios](../../scenarios/proofs.md), and receiver/transaction rules in [Messages](../messages.md). The older prose in V3 still mentions the former user-send exemption: B32 and current LAWS.bend govern the stronger input rule. This assessment does not silently amend either artefact.

### Current mutation evidence

The ordinary `just proofs` passes, but it does not run the mutation suite. On main `5e53cf409e4dba8377d7a4d1e7ec3b5c0b268b03` (the Message/proof files are unchanged from the inventory reference), run `just proofs-setup`, then `BEND="$PWD/proofs/.tools/bend/bin/bend" proofs/messages/mutants/run.sh <law>` separately for the lowercase arguments `m1` through `m10`. M1, M2, M5, M6, M7 and M9 exit 0 after the intended rejection. The four other runs fail as follows:

| Failure | Exit | Observed result |
|---|---:|---|
| M3 | — | Retired by #3563 with its law. |
| M4 | 2 | `cannot apply m4.patch`. |
| M8 | 1 | Extracted **unmutated** proof fails: expected a defined name, observed `m1_main`, location `a35_m1`. The section selector omits a required helper. |
| M10 | 2 | `cannot apply m10.patch`. |

These are observer defects, **not disproofs of the laws**. Keep the stronger model and repair the mutation artefacts/harness under [#1685](https://github.com/saadshahd/roundup/issues/1685), including propagation through the standard proof observer. This is a concrete maintenance cost of parallel model/proof/implementation artefacts; a green ordinary proof run alone cannot establish current mutation coverage. The assessment changes none of them.

### Options and decision

Messages already uses SQLite and a status column. The choice is how much duplicated orchestration surrounds the store, not whether to discover persistence.

| Option | Reuse and cost | Decision |
|---|---|---|
| A bare SQLite FIFO (`id`, receiver, body, status) | [SQLite transactions](https://www.sqlite.org/lang_transaction.html) supply atomic database writes; they cannot commit a Terminal paste in the same transaction. To preserve the table above, add eligibility rank, hold reason/owner, Attempt/revision fences, chain bounds, Digest folding and durable restart/retirement. | Reject as a replacement contract. A smaller **existing** SQLite implementation with these semantics is the preferred internal simplification. |
| [Apalis](https://github.com/apalis-dev/apalis), including its SQLite backend | Maintained background execution, retries, timeouts and persistent jobs. [apalis-sql 0.7.4 SQLite](https://docs.rs/apalis-sql/0.7.4/apalis_sql/sqlite/index.html) documents transaction/min-rowid polling; the current project lists apalis-sqlite separately. This is capability research, not a compatible-version selection. | Do not adopt yet: neither source documents our Takeover/unsent-input/Attempt rules. An adapter must still implement them, retain readable consumed records and suppress automatic ambiguous retries. No measured size/performance saving earns a second storage layer. Recheck candidate versions in the implementation Issue. |
| [Tokio mpsc](https://docs.rs/tokio/latest/tokio/sync/mpsc/) | Maintained bounded in-memory asynchronous channel, already in the runtime ecosystem; useful for wakeups. | Reject as the durable store: process loss cannot replay channel contents, Messages history or operation tombstones. Keep it eligible as a notification primitive behind SQLite, with store resync rather than treating notification receipt as delivery. |
| Existing SQLite, one transaction/reconciliation path per operation | Retains current dependencies, pure step, caller interface, Bend model and behavioral tests. Consolidates repeated checks and buffered publication behind private operations; requires no new public queue interface. | **Simplify**, owned by [#1665](https://github.com/saadshahd/roundup/issues/1665). Preserve laws and all callers. Specify the smallest measured opportunity first, then a separate implementation Issue. |

A crash after recording `delivered` but before Terminal acceptance can lose the actual prompt while preventing duplicate typing. This is the deliberate B8 at-most-once cut, **not** exactly once. Retry only where the existing Adapter reports nonacceptance; changing that trade-off would require a separate product decision, not a queue library switch. No such change is recommended here.

### Lines removed

Measured Messages source outside its separate test directory: **7,025** lines; separate test files: **5,655**; proof tree: **4,236**; docs/messages.md: **197**. The 7,025 includes any inline test/configuration text in source, so it is not a semantic production-code count. Within it, lib.rs is 3,449, store.rs 1,342, pure step.rs 363, Digest/pushes 1,404, hops 172, restart/retirement 295. In particular, the trailing inline test modules in lib.rs (from line 1,526), digest.rs (501) and store.rs (1,160) contribute **2,653** of those lines. Moving them is not a deletion saving.

This assessment removes **0** lines. The recommendation targets **1,500 net source lines** (7,025 → 5,525), from consolidating reconciliation, transaction guards and publication, not moving text to another crate or deleting tests. That number is an engineering feasibility target, **not measured savings** or a promise the current contracts can fit. #1665 must report what actually disappears before implementation is ordered; a smaller proven opportunity replaces the target. Keep the 363-line executable step, all 4,236 proof-tree lines and the ten laws. Removing those would save counted text while losing independent model checking, mutation evidence and the Rust replay bridge the owner explicitly requested.

## Scope

`Door`, `Attention`, `Usage` below mean respectively coordinator capability, user interruption only when blocked, and P9/P10's asked-only starts/cache/batched turns. `Support` is necessary infrastructure or existing user-directed work; it is not itself differentiation. Keep means preserve current behavior and its authorized repairs. Defer means no additional capability until the named release condition, not disable shipped behavior. Remove means implement an already accepted removal through its owning Issue. Estimates are not summed with measured counts.

### Subsystem inventory

Counts are physical lines of tracked `.rs/.ts/.tsx/.css/.bend/.sh/.patch` files, including blanks/comments and fixtures. Crates count only `src/` and `tests/`; UI counts each named directory. “Separate tests” recognizes `/tests/` and `.test.`/`.spec.` filenames, **not inline tests**, so a zero never means untested. Scenario sets below refer to the named files' acceptance, including explicitly overturned clauses; neither counts nor a green old scenario prove terminal-migration completion. There are **273 distinct U headings**, rather than the work order's historical 271.

| Crate (`crates/<name>`) | Lines / separate tests | Scenarios on main | Serves | Decision |
|---|---:|---|---|---|
| agents | 24,494 / 13,494 | agents.md, control.md, spawn-boundary.md, awareness.md, workstream*.md, worktrees.md, models.md, native-questions.md (retired permission IDs) | Door, Usage, Support | Keep lifecycle, Reach, Status and Adapter; #1643 owns internal split. |
| messages | 12,680 / 5,655 | B1–B36 in messages.md; V1–V7 in proofs.md; A35 | Door, Attention, Usage | Simplify internals via #1665; retain delivery contract/laws. |
| checkpoints | 295 / 0 | M10 in mcp.md; A35 in workstream-rewind.md | Door, Support | Keep owner-selected rewind; #1616 owns storage repair. |
| provenance | 215 / 0 | D3–D6 in daemon.md; T8; P1–P10; B11 | Attention, Support | Keep small attribution store; no richer event-sourcing project. |
| pads | 1,858 / 1,142 | P1–P14 in pads.md | Door, Support | Keep notes/Home/export; defer additional visual authoring via #1666. |
| todos | 2,060 / 0 | T1–T14 in todos.md; todo-drawer.md | Door, Attention | Keep tasks and existing blocker graph, not a general planning suite. |
| terminal | 2,620 / 1,430 | terminal.md; quick-terminal.md | Door, Attention, Support | Keep direct interaction and bounded output; #1619 owns transport reuse. |
| contracts | 2,463 / 267 | contract-match.md, rpc.md, app.md and each owning method's scenario | Support | Keep shared types/fingerprint; #1620 owns routing research. |
| rpc | 1,093 / 510 | C1 in rpc.md; S11 in contract-match.md | Support | Keep framing/auth/error isolation; #1620/#1617 own reuse. |
| rup | 12,140 / 11,309 | mcp.md; door-terminal.md M16; awareness.md; native-questions.md (retired permission IDs) | Door, Attention, Usage | Keep thin MCP/hook client and Reach enforcement; no parallel workflow engine. |
| rupd | 5,844 / 1,679 | D1–D7 in daemon.md; resources.md D8; project-data.md; journey.md | Door, Support | Keep composition; #1636/#1642 own concurrency/store changes. |
| desktop | 4,137 / 2,362 | app.md; contract-match.md; project-tabs.md; ui-window*.md | Support | Keep native shell/seam, not a second rendering/tool framework. |
| perf | 2,443 / 1,083 | R16 in perf.md | Usage, Support | Keep budgets and valid class observers; #1251/#1361/#1366 own repairs. |

| App directory (`apps/desktop/src/<name>`) | Lines / separate tests | Scenario source | Serves | Decision |
|---|---:|---|---|---|
| app | 3,193 / 2,585 | app.md, ui-reload.md, ui-image-send.md | Support | Keep shell state and paste routing. |
| bubbles | 1,796 / 864 | ui-bubble-pull.md, quick-terminal.md U164/U165 | Support | Keep user-visible interactive Terminals; do not replicate every vendor shell command here. |
| decisions | 1,360 / 806 | ui-decisions.md, native-questions.md (retired permission IDs), U468 | Attention | Keep actionable decisions; terminal migration owns obsolete relay displays. |
| digest | 248 / 126 | B19–B23, B33, ui-first-journey.md | Door, Usage | Remove view-only Digest Cards under #1497; keep Daemon Digests. |
| drawer | 1,432 / 1,195 | ui-drawer.md, todo-drawer.md | Support | Keep surviving Todos/Pads inspection. |
| header | 2,504 / 1,752 | project-tabs.md, ui-project-tab-box.md, ui-window-bar.md | Support | Keep project selection and pending attention marks. |
| ink | 796 / 442 | ui-kind-glyph.md | Attention | Keep non-colour Status encoding. |
| keys | 1,198 / 895 | ui-keyboard.md, ui-attention.md | Attention, Support | Keep direct/jump access; #1608 owns shortcut reuse. |
| models | 482 / 161 | models.md A36/A37/M12/U377/U378 | Usage | Keep explicit user choice and allowed Models. |
| orders | 1,011 / 656 | orders.md O1–O16 | Door, Usage | Remove view-only order line/Drawer under #1497; keep stored order/first Steer. |
| pads | 4,242 / 2,611 | ui.md U18–U21; ui-rail.md U147–U149; pads.md | Door, Support | Keep current authoring; defer new capabilities under #1666. |
| perf | 410 / 135 | ui-verify.md, perf.md | Support | Keep render latency evidence. |
| plain | 240 / 120 | plain-text.md Q10 | Support | Keep safe Markdown on surviving surfaces. |
| rail | 11,671 / 8,511 | ui-rail*.md, ui-kind-glyph.md, workstream.md, U467/U468 | Door, Attention | Keep identities, nesting of Agents and Status. |
| resize | 551 / 315 | ui-resize.md | Support | Keep narrow usable panes; no freeform desktop layout engine. |
| resources | 648 / 404 | resources.md D8/U408/U444 | Support | Keep selected-Agent CPU/RSS/disk values in the shared bottom bar. It is not Model usage accounting; no background telemetry suite. |
| shelf | 2,379 / 1,664 | ui-shelf*.md, T12–T14, P12 | Door, Support | Keep Workstream-scoped items and review access. |
| state | 1,250 / 453 | ui-persist.md, ui-reload.md, contract-match.md | Support | Keep reconnect, user selection and fingerprint handling. |
| terminal | 5,226 / 3,526 | ui-terminal*.md, U467/U468, ui-file-drop.md | Door, Attention | Keep vendor primary Terminal, xterm and input safety; #1641 owns primitive migration. |
| testing | 10,708 / 7,501 | ui-visual.md, ui-verify.md, ui-first-journey.md, journey.md | Support | Keep behavioral/rendered harness; #1613 owns WebKit, #1652 owns duplicate-test consolidation. |
| thread | 5,416 / 2,944 | ui-first-journey.md, ui-attention.md; overturned by U467/U468 | Door, Attention | Remove superseded presentation through #1497, after #1522. #1622/#1625 own overlapping work until completed or reconciled by their owners. |
| toasts | 984 / 449 | ui-toasts.md U410–U414, U468 | Attention | Keep blocked attention without routine-progress interruption. |
| todos | 5,420 / 3,549 | ui-todo-row.md, todo-drawer.md, ui-edit-in-place.md, ui.md | Door, Attention | Keep usable task review; #1609 owns primitive migration. |

The root App files (App/main, global styles, buttons and Tokens) add **1,189 / 0** lines/separate tests and support all surviving surfaces; they are included separately by the inventory command below. Extension declarations live in `contracts/hooks.ts` (**29** lines); `ext/*` is a workspace glob with no shipped directory. Keep the existing declarations; no Extension marketplace or runtime is recommended. `contracts/generated/` is derivative, not independent feature cost.

### Features beyond the five stages

These costs are subsets of the preceding directories, **not additive**. Keeping existing functionality does not authorize a new feature.

| Feature and current cost | Scenarios | Difference served | Keep / defer / remove and loss |
|---|---|---|---|
| Digests, push caps/folds: digest.rs + pushes.rs **1,404**; App Digest view **248** | B19–B23/B33–B35; P7/P10 | Door, Usage | Keep Daemon summaries: the Door needs bounded child facts without repeatedly reading every Terminal. Preserve count/source readability. Remove only their old Thread presentation through #1497. |
| Question bubbling: hops.rs **172**, plus shared store/lib/step | B13–B17; M8 | Door, Attention | Removed by #3692: the user answers a question in the asking Agent's Terminal. |
| Checkpoint snapshots and rewind: checkpoints **295**, agents/marks.rs **735**, Messages restart/retirement **295**, plus coordinator in rupd | A35; mcp.md M10 | Door, Support | Keep: #808 is explicit owner direction, not speculative breadth. #1616 repairs redundant byte storage; never cancel rewind because Claude Code has single-conversation `/rewind`. Cross-child restoration/consent is roundup's coordination work. |
| Clear/Handoff (retired by #4542): shared agents/rupd lifecycle (no separate exclusive file) | A32, U350 | Door, Usage | Superseded by #4542. Historical decision: Keep existing explicit fresh-context action and archive; no automatic compact/clear or scheduled summarizer. Shared costs cannot honestly be attributed as a deletion subtotal. |
| Provenance **215**, with shared caller/UI last-touch code | D3–D6; B11; T8; P1–P10 | Attention, Support | Keep actor attribution, so answers and edits can be traced. No new universal audit platform, Touch-reason ledger or autonomous forensic workflow. B26 remains a spike. |
| Pad Markdown/storage/export: pads **1,858**, App pads **4,242** | P1–P14; U18–U21/U147 | Door, Support | Keep existing notes, ownership and Home. They preserve review context; external editors remain available. |
| Mermaid/Excalidraw mounts and block plumbing: drawingBlock.ts + mermaidBlock.ts + visualBlocks.ts + visualKinds.ts **404**, inside App pads; CSS/editor/test cost remains shared | U147–U149 in ui-rail.md | Support only | **Defer additions**, #1666. Existing drawings/source/export remain. Deletion savings **0**: removing shipped editors would break accepted scenarios and saved work; Nimbalyst already offers broader visual editors. |
| Models/Effort: agents/models.rs **163** plus App models **482** and Adapter mapping | A36/A37/M12/U377/U378; P8/P9 | Usage | Keep explicit model choice and confirmation; defer no owner-requested setting. No spend prediction dashboard. |
| Resource strip: App resources **648**, shared D8 sampling in agents/rupd | D8/U408/U444 | Support only | Keep selected-running-Agent values only, without Project totals; no sampling without that selection and no monitoring product. It cannot prove P9/P10 token savings. |
| Worktrees/Landing: agents/worktree.rs **738**, shared launch/state/callers | G1–G8; P5 | Support only | Keep git isolation and green explicit Landing; #1635 owns cheaper removal. Use git/editor/PR tools for deep review, not a new IDE or source-control suite. |
| Orders: agents/order.rs **52**, shared store/Brief/MCP; App orders **1,011** | O1–O16 | Door, Usage | Keep bounded instructions and one first Steer; **remove** obsolete visual order presentation under #1497, retaining API/data. |
| Pinned plugins: plugins.rs **300**, skills.rs **401**, vendored assets additional | Q11; Q1/Q6 surviving clauses | Door, Support | Keep explicit owner direction (#1567); no plugin catalogue or second Agent vendor implementation without new selected work. |
| Workstream nesting **0 implemented lines**; new cross-Workstream dependency feature **0 exclusive lines** (existing Todo graph is shared) | A26; T3; P6; journey boundary | No current difference | **Defer**, #1667. Flat Workstreams and Agent nesting remain; existing Todo blockers are preserved. Do not turn a deferred topology into stored unused schema. |
| Sketch storage beyond existing Pads **0 exclusive lines**, B27 local evaluators **0 implemented lines** | P6 goal, B27 spike; journey boundary | Potential Door/Usage, unproven | **Defer**, #1667 for topology/evaluators; #1666 for new visual/Sketch authoring. Preserve P6's eventual Home goal; no silent answer or frontier fallback. Deletion savings **0**. |
| Custom loop: loop scripts **13,617**, workflows **1,577** | loop-rules.md, loop-qa.md | Support only | Keep required gates while [#1602](https://github.com/saadshahd/roundup/issues/1602) assesses stock replacements. Product delivery is the outcome; do not duplicate its per-file removal plan here. |

### What competitors already do

Primary sources checked 2026-10-14; capabilities are reported, not comparative quality benchmarks. These sources do not establish that competitors lack a Door or usage controls.

| Product | Already covered | roundup consequence |
|---|---|---|
| [Conductor worktrees](https://www.conductor.build/docs/concepts/git-worktrees) and [workspaces](https://www.conductor.build/docs/concepts/workspaces-and-branches) | Isolated checkouts/branches for parallel Agents, setup and review/merge/discard flow. | Parallel Agents in worktrees are baseline functionality; improve Door coordination rather than pitch more workspace plumbing as differentiation. |
| [Crystal → Nimbalyst](https://nimbalyst.com/crystal/) and [features](https://nimbalyst.com/crystal) | Crystal's parallel Claude Code/worktrees continue into broader Agent management and visual authoring, including diagrams/drawing. | Avoid rebuilding the visual authoring suite; retain current Pad compatibility and defer more editors. |
| [Claude Squad](https://github.com/smtg-ai/claude-squad) | Multiple terminal Agents, isolated git workspaces and reviewing changes before applying/pushing. | Keep native vendor Terminals and basic isolation; do not reproduce vendor progress output or build another Terminal-management product around it. |
| [Vibe Kanban review documentation](https://github.com/BloopAI/vibe-kanban/blob/main/docs/reviewing-code.mdx) | Diff review, inline feedback and sending work back to an Agent. | Keep an accessible review result/open-editor path; defer a general diff editor or kanban suite unless selected work requires it. |

### Work ownership and release conditions

Every non-keep recommendation has one Work Issue, reused when already owned. New bodies were validated with `python3 loop/orders.py check` before publication. Native blocked-by edges, not this table, schedule work.

| Recommendation | Work Issue | Native prerequisites / overlapping owners |
|---|---|---|
| Simplify existing SQLite orchestration; retain proofs | [#1665](https://github.com/saadshahd/roundup/issues/1665) | #1621, #1617 migrations, #1642 shared database, #1366 input latency, #1581 Door-action holds, #808 rewind. Their stores/lifecycle settle first; this new specification does not change their scope. |
| Repair current mutation evidence without weakening laws | [#1685](https://github.com/saadshahd/roundup/issues/1685) | Native #1621. Owns proof check/harness/patches only; no open Issue owns those exact files. Current delivery/model changes remain intact. |
| Remove superseded Thread, view-only Orders/Digests/Checkpoint cards | [#1497](https://github.com/saadshahd/roundup/issues/1497) | Existing terminal-migration owner: native blockers #1522, #1622 Thread primitives, #1625 Shelf/composer, #1606 Digest/small directories, #1627 copy catalogue and #1652 tests. Do not file a competing removal Issue. Overlapping owners reconcile their acceptance against the accepted removal before any rewrite. |
| Defer additional visual/Sketch authoring | [#1666](https://github.com/saadshahd/roundup/issues/1666) | Native #1621 and #1497. Owns a new policy scenario only, no shared Pad files. #1639's existing Pad primitive migration/repairs continue. New authoring needs a separately scoped Work Issue under recorded direction after U467/U468 share merged real-Daemon/rendered evidence. |
| Defer topology expansion and local evaluators | [#1667](https://github.com/saadshahd/roundup/issues/1667) | Native #1621, #1497 and #808. Owns a new policy scenario only. Keep current Home/Todo graph; release requires terminal-journey evidence and owner-requested A35 Door rewind, then a separately scoped Work Issue under recorded direction. |

No recommendation deletes Checkpoints, weakens a law, changes who may act, or overturns an owner request. No unresolved product choice is needed for this assessment. A future proposal to sacrifice at-most-once delivery, current saved work or the owner's rewind goal must ask then, once, with its concrete consequence. Engineering feasibility of the 1,500-line target belongs to #1665, not a needs-user wait.

### Reproduce and observe

Run the following inventory from the reference checkout. It emits one row per subsystem plus root App files. It counts only tracked files, with no dependencies, build output or generated contracts. Specific feature subtotals above are `wc -l` of the named paths. Scenario attribution is read from those files' acceptance and their existing tests, not inferred from a filename count.

```python
import subprocess
from collections import defaultdict
from pathlib import Path

paths = subprocess.check_output(['git', 'ls-files'], text=True).splitlines()
counts = defaultdict(lambda: [0, 0])
for name in paths:
    p = Path(name)
    if p.suffix not in {'.rs', '.ts', '.tsx', '.css', '.bend', '.sh', '.patch'}:
        continue
    parts = p.parts
    if parts[0] == 'crates' and ('src' in parts[2:] or 'tests' in parts[2:]):
        group = '/'.join(parts[:2])
    elif name.startswith('apps/desktop/src/'):
        group = '/'.join(parts[:4]) if len(parts) > 4 else 'apps/desktop/src (root)'
    elif name.startswith('proofs/messages/'):
        group = 'proofs/messages'
    else:
        continue
    lines = len(p.read_bytes().splitlines())
    counts[group][0] += lines
    if 'tests' in parts or '.test.' in p.name or '.spec.' in p.name:
        counts[group][1] += lines
for group, (total, tests) in sorted(counts.items()):
    print(group, total, tests)
```

Assessment acceptance is policy/manual review, not an invented text-matching test: check all ten law rows against main's actual statements and linked PR evidence; check each subsystem/feature decision and its Issue ownership/native blockers; reproduce line counts; inspect the candidate/competitor primary sources; confirm the diff owns **only this ADR**. No new scenario file is added: #1621's explicit ownership is one new ADR and its canonical assessment clauses are above. The new specification Issues create their own scenario files after this assessment merges; they do not claim those files already exist on main.

| Validation command or review | Failure result / exit |
|---|---|
| Inventory above at reference main; compare table rows | Any differing row makes the assessment stale; script exit 0 only means counting ran. |
| `loop/rules.sh vocab` | Nonzero for a prohibited public name; keep glossary terms. |
| `python3 loop/orders.py check <body-file>` for each new Work Issue | Nonzero means do not publish that body. |
| `git diff origin/main --name-only` | Any path other than this ADR violates #1621's ownership; command exit 0 alone is not acceptance. |
| `just check` | Nonzero remains a reported check failure, not evidence to waive a gate. |
| Per-law mutation commands above | M3/M4/M10 exit 2; M8 exits 1 on the unmutated baseline. #1685 owns repair; this assessment reports failures rather than claiming full mutation coverage. |
| Independent PR review, then required checks/auto-merge | Only a merged ADR completes #1621; ready is not done. |

Implementation work remains in the linked Issues. No App, crates or proofs file is changed to make this assessment pass.
