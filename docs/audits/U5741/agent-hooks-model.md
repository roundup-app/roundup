# U5741 Agent hook, channel, Model and Spawn prompt decisions

Audited main: `e7a69af5294c52a11cf819cc20f6864269a3a65d`. This continues the inventory with the four Daemon Agent methods that `terminal-stream.md` leaves undecided: `agent.channelUp`, `agent.signal`, `agent.setModel` and `agent.spawnPrompt`. It is a source, declaration and scenario reconciliation: no fresh App rendering, runtime call or vendor probe is claimed. Candidate status authorizes no deletion. Real Agent Terminals, direct Agent access, native continuation, the Ask and older-Project reopening stay required until the owner answers.

## Entry points and decisions

Declarations are in `crates/contracts/src/declarations.rs`. A production App caller is a non-test, non-fixture file under `apps/desktop/src` or `crates/desktop/src`, found by exact-string search.

| Row | Independent control and exact public entry points | App caller | Implementation / acceptance |
| --- | --- | --- | --- |
| AH01 | Tell the Daemon an Agent's Channel is up: `agent.channelUp`; no `rup` command, no MCP tool offered (`none(...)`); the Agent's own MCP server calls it at start (`crates/rup/src/mcp.rs`, `report_channel`) | None | `scenarios/agents.md` A11; E6 (a Channel is `missing` when this call does not follow a start; `crates/agents/src/events.rs`). |
| AH02 | Deliver a hook Signal from an Agent's Claude Code session: `agent.signal`; command `rup signal <agent-id>` (stdin; no `--as`) is the hook; no MCP tool | None | `crates/rup/src/main.rs` `deliver`; `crates/rup/tests/signal.rs`; A11; perf measure `hook_loop_ms`. |
| AH03 | Change a running Agent's Model or Effort: `agent.setModel {id, model, effort, confirmed}`; no `rup` command, no MCP tool (user's cost, P8) | None: `scenarios/models.md` U377 removed every App screen that set a Model | `scenarios/models.md` A37 and U377; `crates/rup/tests/models.rs`; `scenarios/mcp.md` M5. |
| AH04 | Read the prompt an Agent's spawn gave: `agent.spawnPrompt {id}`; no `rup` command, no MCP tool | None: `state/connectedProject.ts` lists it only in the set of read methods; `rail/SpawnPromptField.tsx` writes a prompt and never reads one | `scenarios/orders.md` O8 (stores the prompt beside the order; GLOSSARY `Spawn prompt`). The declaration's reason says the Drawer reads it; no Drawer file calls it. |

## All three candidate criteria

Q1: vendor equivalence. Q2: no required five-stage journey action needs this independently offered control. Q3: information/setting with no action on or because of it. A yes on all three makes a candidate, never retirement permission.

| Row | Q1 | Q2 | Q3 | Disposition |
| --- | --- | --- | --- | --- |
| AH01 | **Not established.** | **No.** Without it every Agent's Channel reads `missing`; native request continuation depends on a live Channel. | **No.** It sets a Channel's state. | Not a candidate. Protected. |
| AH02 | **Not established.** | **No.** It is the Claude Code hook that carries every Agent's Status, prompts and Touches. | **No.** | Not a candidate. Protected. |
| AH03 | **Not established.** | **Yes on this evidence:** no journey stage calls it and no App screen offers it. | **No.** It restarts the Agent with a new pair. | Not a candidate: fails Q3 and Q1. A37 acceptance and the user's cost authority (P8) remain. |
| AH04 | **Not established.** | **Yes on this evidence:** no journey stage calls it. | **Yes:** a read with no action on it. | Not a candidate: Q1 is unestablished. It is the closest to one: no reader exists in the App, so an owner may be shown it once Q1 is settled. Its stored prompt (O8) is persisted Project data, so any retirement keeps older Projects reopening. |

No row is a candidate on this evidence.

## Dependencies

AH01 and AH02 share the hook Agent (A11) and the E6 Channel state. AH03 depends on A21 data and the A22 resume path. AH04 reads a column that `agent.spawn` writes; dropping the read alone leaves that column, and any removal of the column needs a reader of older rows (the older-Project reopening requirement, never an owner option).

## Remaining

Vendor Q1 comparisons, a stage trace for AH04, a fresh runtime role census, and the other undecided methods (`action.*`; `ask.*`; `daemon.*`; `events.subscribe`; `pad.read`; `project.setWorktrees`, `start`; `rail.*` deletion/group/redo/restore/tree/removeSelection; `skill.status`; `todo.*` references/history/reorder; `workstream.*` queue methods) stay unfinished. No owner choice or deletion is made.
