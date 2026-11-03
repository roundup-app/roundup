# U5741 Agent lifecycle operation decisions

Audited main: `058c00704cb6ba939eea619478328070e16fdbb4`. This continues the inventory with six independently callable Agent lifecycle operations that no earlier decision file decides. It is a source, declaration and scenario reconciliation: no fresh App rendering, runtime call or vendor probe is claimed. Candidate status authorizes no deletion. Real Agent Terminals, direct Agent access, native continuation, the Ask, Message authority and Reach limits stay required until the owner answers.

## Entry points and decisions

Declarations are in `crates/contracts/src/declarations.rs`; the offers are the rows of `endpoints.md` (`rup agent <verb>`, and an MCP tool of the same name under both roles). A production App caller is a non-test file under `apps/desktop/src` that calls the method.

| Row | Independent action and exact public entry points | App caller | Implementation / acceptance |
| --- | --- | --- | --- |
| AL01 | Stop an Agent in your Reach: `agent.stop`; `rup agent stop`; `agent_stop` | `apps/desktop/src/rail/menu/model.ts` (Rail menu Stop) | `scenarios/agents.md` A16 (`rail.remove` stops as `agent.stop` does); `scenarios/mcp.md` Reach list. |
| AL02 | Send a prompt as the user would: `agent.prompt`; `rup agent prompt`; `agent_prompt` | None found; the App's Steer and Ask paths are separate methods. | `scenarios/cli.md` I6; `scenarios/agent-lifecycle.md` A4452d (only the user's words are typed); `crates/agents/tests/scenarios/steer.rs`. |
| AL03 | Interrupt an Agent's turn: `agent.interrupt`; `rup agent interrupt`; `agent_interrupt` | None found. | `scenarios/control.md` H13, H17, H4702a; `crates/agents/tests/scenarios/interrupt.rs`. |
| AL04 | Land an Agent's Worktree on the Base: `agent.land`; `rup agent land`; `agent_land` | None found outside tests. | `scenarios/worktrees.md` G4, G8 (`g8_worktree_state_and_land_shapes`); `crates/agents/tests/scenarios/landing.rs`. |
| AL05 | Discard an Agent's Worktree and changes: `agent.discard`; `rup agent discard`; `agent_discard` | None found outside tests. | `scenarios/worktrees.md`; `scenarios/mcp.md` (the success action names the Agent); `crates/agents/tests/scenarios/worktrees.rs`, `crates/rup/tests/mcp/names.rs`. |
| AL06 | Ask to be woken when named Agents finish: `agent.wake`; `rup agent wake`; `agent_wake` | None found. | `scenarios/messages.md` B41, B42, B45, B48; `crates/contracts/tests/b48_woken.rs`. |

## All three candidate criteria

Q1: vendor equivalence. Q2: no required five-stage journey action needs this independently offered control. Q3: information/setting with no action on or because of it. A yes makes a candidate, never retirement permission.

| Row | Q1 | Q2 | Q3 | Disposition |
| --- | --- | --- | --- | --- |
| AL01 | **Not established.** | **No.** The user stops work from the Rail and a Door stops its children. | **No.** It acts. | Not a candidate. |
| AL02 | **Not established.** | **Unproven.** A Door's Steer of a child may need it; the journey text was not traced to a stage. | **No.** It types into a Terminal. | Not a candidate on this evidence; protected by direct access. |
| AL03 | **Not established.** | **Unproven.** The App has no caller; a Door's interrupt of a child was not traced. | **No.** It acts. | Not a candidate on this evidence. |
| AL04 | **Not established.** | **No.** Landing retained work is how an Agent's change reaches the Base. | **No.** It acts. | Not a candidate. |
| AL05 | **Not established.** | **Unproven.** Discard is destructive and its App route was not found; no stage was traced to it. | **No.** It acts and deletes changes. | Not a candidate on this evidence; any answer needs the retained-work check. |
| AL06 | **Not established.** | **Yes.** No journey stage waits on named Agents through this call. | **No.** It registers a stored request and fires a Message. | Candidate: Q2. Dated direction: the owner asked for CLI parity with MCP in #2218 (B41), so a delete reverses it. |

## Dependencies

AL06 shares stored wake requests and the Message that fires; selecting it requires keeping Message authority laws (M1 to M10) and opening older Projects holding unfired requests with Agent identities retained (N5467). AL01 and AL04 are bound to retained work and the Worktree. Every row stays subject to the older-Project reopening requirement, never an owner option.

## Remaining

Vendor Q1 comparisons, a tracing of `agent.prompt`, `agent.interrupt` and `agent.discard` to journey stages, a fresh runtime role census, and the other undecided methods (`agent.spawn`, `agent.resume`, `agent.run`, `agent.worktreeState`, `agent.changedFiles`, `agent.compareFile`, `agent.setOrder`, `agent.setVisibility`, `terminal.*` reads, `todo.*` references, `rail.*` and `workstream.*` queue methods, `project.*`) stay unfinished. No owner choice or deletion is made.
