# U5741 Terminal read decisions

Audited main: `6c9ebd997a409c6af4c532462a1fb64b9c24f3e3`. This continues the inventory with the six Daemon reads of a Terminal that the Agent lifecycle and context files leave undecided. It is a source, declaration and scenario reconciliation: no fresh App rendering, runtime call or vendor probe is claimed. Candidate status authorizes no deletion. Real Agent Terminals, direct Agent access, native continuation, the Ask and older-Project reopening stay required until the owner answers. The write, resize, kill, open, spawn and close methods are decided in `terminals.md` and `endpoints.md`, not here.

## Entry points and decisions

Declarations are in `crates/contracts/src/declarations.rs`; the offers are the rows of `endpoints.md`. A production App caller is a non-test, non-fixture file under `apps/desktop/src` that calls the method; a symbol search of `apps/desktop/src` and `crates/desktop/src` for each name found these.

| Row | Independent read and exact public entry points | App caller | Implementation / acceptance |
| --- | --- | --- | --- |
| TR01 | List the Terminals: `terminal.list`; no `rup` command, no MCP tool | `apps/desktop/src/state/rail.ts` (reopen liveness), `state/connectedProject.ts` (read set) | `scenarios/mcp.md` M5 row (`terminal.list` kept off MCP by M14); `scenarios/agents.md` A12a. |
| TR02 | Read a snapshot of a Terminal's emulator: `terminal.snapshot`; no `rup` command, no MCP tool | `state/connectedProject.ts` (read set); the App's retained emulator | `scenarios/mcp.md` M13 ("`terminal.snapshot` stays the App's"). |
| TR03 | Bounded raw-output recovery on Terminal return: `terminal.catchUp`; no `rup` command, no MCP tool | No caller found by the symbol search; the declaration names the App's retained emulator (Z3788a). | `scenarios/app-libraries.md` (output retention policy); declaration reason Z3788a. |
| TR04 | Read a Terminal's screen as plain text: `terminal.screen`; `rup terminal screen`; `terminal_screen` | `state/connectedProject.ts` (read set only) | `scenarios/mcp.md` M13 Tools, Reach, Read only, Cap. |
| TR05 | Read a Terminal's output from an offset: `terminal.read`; `rup terminal read`; `terminal_read` | `state/connectedProject.ts` (read set only) | `scenarios/mcp.md` M13; `scenarios/cli.md` I1. |
| TR06 | Search a Terminal's output for a pattern: `terminal.search`; `rup terminal search`; `terminal_search` | `state/connectedProject.ts` (read set only) | `scenarios/mcp.md` M13; `scenarios/cli.md` I1. |

## All three candidate criteria

Q1: vendor equivalence. Q2: no required five-stage journey action needs this independently offered control. Q3: information/setting with no action on or because of it. A yes makes a candidate, never retirement permission.

| Row | Q1 | Q2 | Q3 | Disposition |
| --- | --- | --- | --- | --- |
| TR01 | **Not established.** | **No.** Reopening finds the running Terminals through it. | **No.** The Rail's liveness acts on it. | Not a candidate. |
| TR02 | **Not established.** | **No.** The App restores a Terminal's screen from it. | **No.** | Not a candidate. |
| TR03 | **Not established.** | **Unproven.** No caller was found, but the declaration says the App replays through it; the symbol search is lexical and no stage was traced. | **No.** | Not a candidate on this evidence. |
| TR04 | **Not established.** | **Unproven.** A Door reading its staff's Runs may need it; not traced to a stage. | **No.** It informs Agents' next action. | Not a candidate on this evidence. Dated direction: the user asked for Agent reads in #814 (M13). |
| TR05 | **Not established.** | **Unproven.** As TR04. | **No.** | Not a candidate on this evidence. Same #814 direction. |
| TR06 | **Not established.** | **Unproven.** As TR04. | **No.** | Not a candidate on this evidence. Same #814 direction. |

No row is a candidate: each fails Q1 as unestablished and Q2/Q3 as protected or unproven. An unproven Q2 is not a yes; a later trace may change a row.

## Dependencies

TR04 to TR06 share the Reach limits of M7/M13 (an ownerless Terminal is `FORBIDDEN` to an Agent) and X13's capped text. TR01 to TR03 are the App's own reads and bind real Agent Terminals and reopen. Every row stays subject to the older-Project reopening requirement, never an owner option.

## Remaining

Vendor Q1 comparisons, a journey-stage trace for TR03 to TR06, a caller census of `connectedProject.ts`'s read set, a fresh runtime role census, and the other undecided methods (`agent.spawn`, `agent.resume`, `agent.run`, `agent.setOrder`, `agent.setVisibility`, `todo.*` references, `rail.*` and `workstream.*` queue methods, `project.*`) stay unfinished. No owner choice or deletion is made.
