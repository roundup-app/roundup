# U5741 Terminal stream, scheme and keystroke probe decisions

Audited main: `c03abf5e014d9b903b1881d873e465351188a4b9`. This continues the inventory with the four Daemon Terminal methods that `terminal-reads.md` and `terminals.md` leave undecided: `terminal.output`, `terminal.outputStop`, `terminal.scheme` and `terminal.measure`. It is a source, declaration and scenario reconciliation: no fresh App rendering, runtime call or vendor probe is claimed. Candidate status authorizes no deletion. Real Agent Terminals, direct Agent access, native continuation, the Ask and older-Project reopening stay required until the owner answers.

## Entry points and decisions

Declarations are in `crates/contracts/src/declarations.rs`. Each method has no `rup` command and no MCP tool; the declaration's `none(...)` reason says so. A production App caller is a non-test, non-fixture file under `apps/desktop/src` or `crates/desktop/src`, found by exact-string search.

| Row | Independent control and exact public entry points | App caller | Implementation / acceptance |
| --- | --- | --- | --- |
| TP01 | Start a Terminal's byte stream: `terminal.output`; no `rup` command, no MCP tool (an Agent reads text with `terminal_read`) | `apps/desktop/src/app/tauri.ts` through the `terminal_output` seam command (`app/seam.ts`; `crates/desktop/src/lib.rs`); `terminal/screens.ts` | `scenarios/terminal-stream.md` X14; GLOSSARY `Output stream`; perf measure `write_to_output_p95_ms` (`crates/perf/src/measure.rs`). |
| TP02 | Stop that stream: `terminal.outputStop`; no `rup` command, no MCP tool | `app/tauri.ts` through `terminal_output_stop`; `crates/rup/tests/x14.rs` exercises it | X14 ("`terminal.outputStop` or closing the connection releases it"); the Daemon releases on connection close without it. |
| TP03 | Tell the Daemon the App's colour scheme and background/foreground: `terminal.scheme`; no `rup` command, no MCP tool | `apps/desktop/src/terminal/scheme.ts` | `scenarios/terminal.md` X17 (a program's colour query is answered from the App's scheme); `scenarios/library-reuse.md` Z3742g. |
| TP04 | Record an opt-in keystroke timing probe: `terminal.measure`; no `rup` command, no MCP tool | None in production: only `apps/desktop/src/perf/run.ts` in a `VITE_ROUNDUP_PERF` build and `crates/terminal/src/recorder_tests.rs` | `scenarios/perf.md` R20 and R21; `just perf-keystroke`; GLOSSARY `Keystroke measurement`. |

## All three candidate criteria

Q1: vendor equivalence. Q2: no required five-stage journey action needs this independently offered control. Q3: information/setting with no action on or because of it. A yes on all three makes a candidate, never retirement permission.

| Row | Q1 | Q2 | Q3 | Disposition |
| --- | --- | --- | --- | --- |
| TP01 | **Not established.** | **No.** Every real Agent Terminal and shell Terminal shows its output through this stream; direct Agent access needs it. | **No.** | Not a candidate. Protected. |
| TP02 | **Not established.** | **Unproven.** The Daemon also releases the stream on connection close, but the App's tab switch uses the call; not traced. | **No.** It acts on the Daemon's per-connection selection. | Not a candidate on this evidence. |
| TP03 | **Not established.** | **Unproven.** Programs in a Terminal (Agents included) see the App's colours through it; no stage was traced to need it independently. | **No.** It changes what programs answer. | Not a candidate on this evidence. |
| TP04 | **Not established.** | **Yes on this evidence:** no journey stage calls it. | **Yes:** it records information and no action follows from it in the App. | Not a candidate: Q1 is unestablished, and R20/R21 and AGENTS.md rule 7 name it as the keystroke observer. Dropping it retires existing acceptance, which a candidate is not permission to do. |

No row is a candidate. TP04 is the only row meeting Q2 and Q3, and it fails the all-criteria test on Q1 and on rule 7; an owner may still be shown it with its perf role, but that choice would amend R20/R21 and `just perf-keystroke` first.

## Dependencies

TP01 and TP02 share the per-connection selection of X14 and the `terminal.gap` recovery by `terminal.snapshot` (TR02). TP03 shares X17's early OSC colour-query answer. TP04 depends on `terminal.write` and TP01 for its hops. Every row stays subject to the older-Project reopening requirement, never an owner option: none of the four stores Project data.

## Remaining

Vendor Q1 comparisons, a journey-stage trace for TP02 and TP03, a fresh runtime role census, and the other undecided methods (`agent.channelUp`, `setModel`, `signal`, `spawnPrompt`; `action.*`; `ask.*`; `daemon.*`; `events.subscribe`; `pad.read`; `project.setWorktrees`, `start`; `rail.*` deletion/group/redo/restore/tree/removeSelection; `skill.status`; `todo.*` references/history/reorder; `workstream.*` queue methods) stay unfinished. No owner choice or deletion is made.
