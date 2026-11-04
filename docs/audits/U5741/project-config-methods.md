# U5741 Project configuration method decisions

Audited main: `b66cfd2c549d2bb6da59f431090d258ca6aa199c`. This continues the inventory with five Daemon Project-configuration methods that the other files leave undecided. It is a source, declaration and scenario reconciliation: no fresh rendering, runtime call or vendor probe is claimed. Candidate status authorizes no deletion. Real Agent Terminals, direct Agent access, native continuation, the Ask and older-Project reopening stay required until the owner answers.

## Entry points and decisions

Declarations are in `crates/contracts/src/declarations.rs`. None of the five has a CLI command or MCP tool (declared `none(...)`; `endpoints.md`, `scenarios/mcp.md` Reach list). A production App caller is a non-test file under `apps/desktop/src` or `crates/desktop/src`; an exact-string and camel-case search of both found none for any row. `project.getPrepared` appears only in the connected-Project read-allowlist (`state/connectedProject.ts`), not as a call.

| Row | Independent method and public entry points | Non-test callers | Implementation / acceptance |
| --- | --- | --- | --- |
| PC01 | Turn the roundup MCP server on or off for Agents: `project.setMcp`; no CLI or MCP offer | none | `scenarios/mcp.md` M2219; `crates/rupd/tests/m2219_mcp_setting.rs` (`m2219_the_setting_resolves_from_the_environment_then_the_project`). |
| PC02 | Enrol directories and set setup and readiness commands: `project.setPrepared`; no CLI or MCP offer | none | `scenarios/worktrees.md` G2542a–G2542c; `crates/agents/src/prepared.rs`; fixtures in `crates/agents/tests/scenarios/prepared_support.rs`, `crates/rup/tests/project_start.rs`. |
| PC03 | Read the prepared-directory settings: `project.getPrepared`; no CLI or MCP offer | none (read-allowlist entry only) | `crates/agents/tests/scenarios/worktrees.rs` (reads the unset state); `crates/perf/tests/large_project.rs` (read-path workload). |
| PC04 | Run setup then readiness for one unavailable directory: `project.prepareDirectory`; no CLI or MCP offer | none | `scenarios/worktrees.md` G2542a; `crates/agents/tests/scenarios/worktrees.rs`. |
| PC05 | Set Model and Effort per role: `project.setModels`; no CLI or MCP offer | none; the App's Models sheet is retired (U377, `apps/desktop/src/rail/u377_no_models.test.tsx`) | `scenarios/models.md` A36 (`a36_set_models_round_trips_and_survives_a_restart`), M5. |

## All three candidate criteria

Q1: vendor equivalence. Q2: no required five-stage journey action needs this independently offered control. Q3: information/setting with no action on or because of it. A yes makes a candidate, never retirement permission.

| Row | Q1 | Q2 | Q3 | Disposition |
| --- | --- | --- | --- | --- |
| PC01 | **Not established.** No vendor probe was run. | **No.** M2219 decides whether the next Agent launches with the roundup tools; direct Agent access and the Ask depend on that launch fact. | **No.** Launch argv and the tool list change because of it. | Not a candidate. |
| PC02 | **Not established.** | **Unproven.** G2542 prepared-directory mode needs enrolment before any Agent starts there; no stage trace shows another route to enrol. | **No.** Enrolment is explicit consent that gates launches. | Not a candidate on this evidence. |
| PC03 | **Not established.** | **Unproven.** No journey stage reads it; only tests and the perf read-path do. | **Yes.** It returns configuration and triggers nothing. | Candidate on Q3 only; Q1 and Q2 are unproven, so it is not offered. |
| PC04 | **Not established.** | **Unproven.** An unavailable directory stays unavailable until this passes (`prepared.rs` header). | **No.** It runs the commands. | Not a candidate on this evidence. |
| PC05 | **Not established.** | **Unproven.** The App sheet is retired by U377, so this method is the only way to set a role's Model; whether a journey stage needs a non-default is untraced. | **No.** Launch flags and cost change because of it. | Not a candidate on this evidence. |

PC03 meets one of three criteria, which is short of the specification's rule; it is listed here so the final ask can decide it with the other Prepared rows, and it is not offered alone.

## Dated direction

U377's retirement of the App Models sheet, the G2542 prepared-directory scenarios and M2219 are recorded in their scenario files; `direction.md` holds no owner-dated row for them, so no reversal is named. Deleting PC05 would remove the last surface for the Model choice (P8); deleting PC01 reverses M2219's owner-found fix.

## Remaining

Vendor Q1 comparisons, stage traces for PC02, PC04 and PC05, the older-data shapes of stored `prepared`, `mcp` and `models` settings with their reopen tests, a fresh runtime role census, and the remaining undecided methods (`todo.*` references, `rail.*` and `workstream.*` queue methods, other `project.*`) stay unfinished. No owner choice or deletion is made.
