# U5741 Agent start and configuration decisions

Audited main: `fbc754cf50339cb73c744f3a4e714375444cd659`. This continues the inventory with five independently callable Agent methods that no earlier decision file decides: `agent.spawn`, `agent.resume`, `agent.run`, `agent.setOrder` and `agent.setVisibility`. It is a source, declaration and scenario reconciliation: no fresh App rendering, runtime call or vendor probe is claimed. Candidate status authorizes no deletion. Real Agent Terminals, direct Agent access, native continuation, the Ask, Message authority and Reach limits stay required until the owner answers.

## Entry points and decisions

Declarations are in `crates/contracts/src/declarations.rs`; the offers are the rows of `endpoints.md`. A production App caller is a non-test file under `apps/desktop/src` that calls the method by name (exact-string search of `agent.<method>`).

| Row | Independent action and exact public entry points | App caller | Implementation / acceptance |
| --- | --- | --- | --- |
| AS01 | Start an Agent: `agent.spawn`; `rup agent spawn`; `agent_spawn` (both roles) | `rail/Rail.tsx` (two calls), `rail/importState.ts`, `app/ProjectOpening.tsx` | `scenarios/agents.md`; `scenarios/spawn-boundary.md`. |
| AS02 | Continue a saved conversation: `agent.resume`; `rup agent resume`; `agent_resume` (both roles) | `rail/menu/model.ts` (two calls), `inbox/Inbox.tsx` | `scenarios/agents.md` A5213 (offered Rail actions) and U2694d (explicit normal or yolo mode, cited in `rail/menu/model.ts`). |
| AS03 | Run a command in an owned Terminal: `agent.run`; `rup agent run`; `agent_run` (Agent role; the Door's offer was omitted by `scenarios/door-terminal.md`) | None found; the App opens Terminals through `terminal.*` methods. | `scenarios/quick-terminal.md` X11 (`x11_agent_run_starts_an_owned_terminal_and_adds_no_rail_node` in `crates/agents/tests/scenarios/runs.rs`); `scenarios/mcp.md` M15 permission gate. |
| AS04 | Replace an Agent's order: `agent.setOrder`; `rup agent set-order`; `agent_set_order` | None found outside tests. O16 orders the Drawer edit through this call; the non-test search found none, so reachability is unresolved. | `scenarios/orders.md` O4, O13, Captured Order; `crates/agents/tests/scenarios/orders.rs`. |
| AS05 | Mark a Door's child shown or internal: `agent.setVisibility`; `rup agent set-visibility`; `agent_set_visibility` (Door only) | None found. | `scenarios/door-child-visibility.md` U5531a (`u5531a_door_tool_round_trip_and_reopen`); `scenarios/daemon.md` retained-history clause. |

## All three candidate criteria

Q1: vendor equivalence. Q2: no required five-stage journey action needs this independently offered control. Q3: information/setting with no action on or because of it. A yes makes a candidate, never retirement permission.

| Row | Q1 | Q2 | Q3 | Disposition |
| --- | --- | --- | --- | --- |
| AS01 | **Not established.** | **No.** Starting work is the journey. | **No.** It acts. | Not a candidate. |
| AS02 | **Not established.** | **No.** Continuation after a request needs it. | **No.** It acts. | Not a candidate; protected by native continuation. |
| AS03 | **Not established.** | **Unproven.** Door-terminal.md already narrows it; the journey text was not traced to a stage. | **No.** It starts a Terminal. | Not a candidate on this evidence; real Agent Terminals are protected. |
| AS04 | **Not established.** | **Unproven.** O4/O13 let an Agent or Door settle an order; no stage was traced to the call. | **No.** It acts. | Not a candidate on this evidence; any answer needs the stored-order reopen check. |
| AS05 | **Not established.** | **Unproven.** No stage was traced to marking a child internal. | **No.** It acts. | Not a candidate on this evidence. Dated direction: U5531a added it on request, so a delete reverses it. |

## Dependencies

AS04 and AS05 persist an order and a visibility on stored Rail nodes; any selection must open older Projects holding either (absent visibility means shown; N5467) with Agent identities and retained work kept. AS01 and AS02 are bound to the five-stage journey and are not offered for deletion.

## Remaining

Vendor Q1 comparisons, journey tracing of AS03 to AS05, resolution of AS04's App reachability, a fresh runtime role census, and the other undecided methods (`agent.worktreeState`, `agent.changedFiles`, `agent.compareFile`, `terminal.*` reads, `todo.*` references, `rail.*` and `workstream.*` queue methods, `project.*`) stay unfinished. No owner choice or deletion is made.
