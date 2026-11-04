# U5741 Pad read, Worktrees setting, Project start, Naming and transport decisions

Audited main: `8cdbebf0804c4e8c81725348fd26ab8b52e5903a`. This continues the inventory with methods `agent-hooks-model.md` leaves undecided: `pad.read`, `project.setWorktrees`, `project.start`, `daemon.getNaming`/`daemon.setNaming`, `daemon.ping`/`daemon.methods`/`daemon.identify` and `events.subscribe`. It is a source, declaration and scenario reconciliation: no fresh App rendering, runtime call or vendor probe is claimed. Candidate status authorizes no deletion. Real Agent Terminals, direct Agent access, native continuation, the Ask and older-Project reopening stay required until the owner answers.

## Entry points and decisions

Declarations are in `crates/contracts/src/declarations.rs`. A production App caller is a non-test, non-fixture file under `apps/desktop/src` or `crates/desktop/src`, found by exact-string search.

| Row | Independent control and exact public entry points | App caller | Implementation / acceptance |
| --- | --- | --- | --- |
| DP01 | Read one Pad: `pad.read {name}`; offered to Agents and the Door by declaration (`all(schema(...))`, MCP tool `pad_read`, `scenarios/mcp.md` M1) | `pads/PadContent.tsx` (opening a Pad and its conflict re-read) | Pad scenarios; the editor's conflict path depends on it. |
| DP02 | Turn Worktrees on or off and set the Landing command: `project.setWorktrees {on, check}`; offered by declaration (`all(...)`, MCP tool `project_setWorktrees`; `rup` renders its reply text in `crates/rup/src/mcp.rs`) | None by exact-string search: no `apps/desktop/src` or `crates/desktop/src` file calls it | `scenarios/worktrees.md` G1 (stored; `project.get` reads it back); `scenarios/import-work.md` (Worktrees on provisions a Worktree per import). |
| DP03 | Start an Agent, Workstream or Mode with a prompt in a target Project through the App: `project.start {kind, name, prompt, ...}`; `rup` command and MCP tool; the App serves it as a seam action | `App.tsx` (`serveActions`), `app/seam.ts`, `app/ProjectOpening.tsx` | Seam command; waits for consent to open an unopened folder. |
| DP04 | Read and save the automatic naming settings: `daemon.getNaming`, `daemon.setNaming`; no `rup` command, no MCP tool (`none(...)`: the user's naming policy, A4688a) | `settings/NamingSettings.tsx`; `crates/desktop/src/state.rs` | A4688a; Settings. |
| DP05 | Daemon discovery and identity: `daemon.ping`, `daemon.methods`, `daemon.identify`; transport, `none("transport, not an action")` | `app/contractMatch.ts` (ping, methods; S11 contract match), `state/connectedProject.ts`; `daemon.identify` by `crates/rup/src/cli.rs`, `main.rs`, `mcp.rs` | S11; `daemon.ping` is a rule 7 observer (`cold_start_ms`, `ping_p95_ms`). |
| DP06 | Follow the Event log from a number: `events.subscribe`; offered with a custom stream (`events_stream()`) | `crates/desktop/src/state.rs`; `crates/rup/src/mcp.rs` | Every live App update and the Channel push depend on it; write-to-output measures delivery on it. |

## All three candidate criteria

Q1: vendor equivalence. Q2: no required five-stage journey action needs this independently offered control. Q3: information/setting with no action on or because of it. A yes on all three makes a candidate, never retirement permission.

| Row | Q1 | Q2 | Q3 | Disposition |
| --- | --- | --- | --- | --- |
| DP01 | **Not established.** | **No.** Opening a Pad in the App and an Agent reading its Pad use it. | **Yes:** a read. | Not a candidate: fails Q2. |
| DP02 | **Not established.** | **Yes on this evidence:** no App screen offers it; no journey stage calls it. | **No.** It changes how every later Agent start and import provisions Worktrees. | Not a candidate: fails Q3 and Q1. G1 stored data stays, and older Projects keep reopening. |
| DP03 | **Not established.** | **No.** It is the way an outside request starts work in the App (native request continuation). | **No.** | Not a candidate. Protected. |
| DP04 | **Not established.** | **Yes on this evidence:** the journey needs no naming preference. | **No.** It is a setting whose value changes later names. | Not a candidate: fails Q3 and Q1. |
| DP05 | **Not established.** | **No.** Every connection and the contract match (S11) use them. | **Yes:** reads; `identify` sets the actor. | Not a candidate: fails Q2. |
| DP06 | **Not established.** | **No.** Without it nothing updates live. | **No.** | Not a candidate. Protected. |

No row is a candidate on this evidence.

## Dependencies

DP02 stores a column `project.get` reads (G1); dropping only the offer leaves it, and any removal of the setting needs a reader of older rows (the older-Project reopening requirement, never an owner option). DP03 depends on DP05's contract match and DP06's stream. DP04 data is the global preference store, not a Project's.

## Remaining

Vendor Q1 comparisons, a fresh runtime role census, an App-reachability check of DP02 beyond exact-string search, and the other undecided methods (`action.*`; `ask.*`; `rail.*` deletion/group/redo/restore/tree/removeSelection; `skill.status`; `todo.*` references/history/reorder; `workstream.*` queue methods) stay unfinished. No owner choice or deletion is made.
