# U5741 Agent context and instruction decisions

Audited main: `a743b75fe4c9f0e2f47aba05493c284d83f311a2`. This continues the inventory with seven independently callable Agent read and extras operations that no earlier decision file names. It is a source and declaration reconciliation; no fresh App rendering, runtime call or vendor probe is claimed. Candidate status authorizes no deletion. Real Agent Terminals, direct Agent access, native continuation, the Ask, Message authority and Reach limits remain required until the owner answers.

## Entry points and decisions

Declarations are in `crates/contracts/src/declarations.rs`; offers are those of `endpoints.md` and `catalogues/public-current.json`. The App lists all but `agent.extras_add` in its connected-method list (`apps/desktop/src/state/connectedProject.ts`); no mounted component was found calling them, so the list is not evidence of a control.

| Row | Independent action and exact public entry points | Implementation / acceptance |
| --- | --- | --- |
| AC01 | Read an Agent's Brief: `agent.brief`; no `rup` verb and no MCP tool; `crates/rup/src/main.rs::brief` calls it for the Agent's own CLI path | `crates/rupd/src/route.rs` (Reach); `scenarios/lean-child-start.md`; `scenarios/rup-ext.md` LK2 (`FORBIDDEN` where `agent.brief` is). |
| AC02 | List an Agent's skills: `agent.skills`; no `rup` verb and no MCP tool | `crates/rupd/src/contract_handlers.rs::rpc_agent_skills`; `crates/rupd/src/contract_tests.rs` (unknown and known id replies). |
| AC03 | Read an Agent's context: `agent.context`; `rup agent context`; `agent_context` (Agent and Door MCP) | `crates/rup/src/mcp.rs` shapes an Ask reply; I2706a (`crates/rup/tests/cli.rs::i2706a_plain_output_uses_rail_names`, as named in `scenarios/cli.md`). |
| AC04 | Read the digest of an Agent's work: `agent.digest`; `rup agent digest`; `agent_digest` (Door only) | `crates/rupd/src/contract_handlers.rs::rpc_agent_digest`; I5, I2706a, `scenarios/door-terminal.md`; LK2 composes the same digest for an Agent link. |
| AC05 | Read exact instruction revisions and Attempt-bound delivery facts: `agent.instructions`; `rup agent instructions`; `agent_instructions` (Agent and Door) | `crates/agents/src/dispatch.rs::rpc_agent_instructions`; `crates/rup/tests/instructions.rs`; reading sends nothing. |
| AC06 | Read the names a Door may give a child: `agent.extras`; `rup agent extras`; `agent_extras` (Door only) | `crates/agents/src/dispatch.rs::rpc_agent_extras`; `crates/rup/tests/lean_extras.rs`; `scenarios/lean-child-start.md`. |
| AC07 | Add a name a Door may give a child: `agent.extras_add`; `rup agent extras-add`; `agent_extras_add` (Door only) | `crates/agents/src/dispatch.rs::rpc_agent_extras_add`; `crates/rup/tests/lean_extras.rs`. |

## All three candidate criteria

Q1: vendor equivalence. Q2: no required five-stage journey action needs this independently offered control. Q3: information/setting with no action on or because of it. A yes makes a candidate, never retirement permission.

| Row | Q1 | Q2 | Q3 | Disposition |
| --- | --- | --- | --- | --- |
| AC01 | **Not established.** No vendor comparison was run. | **Unproven.** The Brief is in the Agent's argv (declaration text); no journey stage names a separate read. | **Unproven.** No App caller was found; an Agent's own path reads it. | Not a candidate on the evidence here; needs a caller census. |
| AC02 | **Not established.** | **Yes.** No journey stage lists an Agent's skills; the App's palette is its own list (declaration text). | **Yes.** It returns information, with no action on or because of it found. | Candidate: Q2, Q3. |
| AC03 | **Not established.** | **No.** Direct Agent access and Request need the Agent's context to be inspectable by another Agent. | **No.** The reply directs a next action (Ask, continuation). | Not a candidate. |
| AC04 | **Not established.** | **No.** Review needs the outcome and retained work; the digest is the Door's read of it, and LK2 reuses it. | **No.** A Door acts on what it reports. | Not a candidate. |
| AC05 | **Not established.** | **No.** Attempt-bound delivery facts back native continuation. | **No.** Resume and acceptance read them. | Not a candidate; protected. |
| AC06 | **Not established.** | **Yes.** No journey stage reads the Door's allowed names. | **No.** It tells the Door what it may pass to a child. | Candidate: Q2. |
| AC07 | **Not established.** | **Yes.** No journey stage adds a name for a child. | **No.** It changes what a Door may pass. | Candidate: Q2; depends on AC06's reader. |

## Dependencies

AC06 and AC07 share the stored extras names; selecting AC06 leaves AC07 unreadable but not useless, so the final request must state both. Any deletion must open older Projects with stored extras, retaining Agent identities (N5467). AC03–AC05 are bound to protected Ask, Attempt and continuation paths.

## Remaining

Vendor Q1 comparisons, an AC01 caller census, a fresh runtime role census, and the other undecided methods (the `agent.*` lifecycle methods, `terminal.*` reads, `todo.*` references, `rail.*` and `workstream.*` queue methods, `project.*`) stay unfinished (`entry-points.md` continuation order). No owner choice or deletion is made.
