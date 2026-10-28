# Workstream time

Module: Workstream measurement in `crates/agents`, with vendor interpretation only in its Adapter; `crates/contracts`, generated contracts and Daemon/public CLI callers; the time view in `apps/desktop`. Ids: U3016a–U3016m; U3016b, U3016h are retired.

Outcome: from a Workstream, understand where its Agents' time went and who waited on the user, as one chart, while work runs, then inspect the largest Agents without leaving that Workstream. Journey stages: Understand and Review (`.agents/data/journey.md`). This file specifies acceptance; #3016 owns the original implementation progress and engineering observations; #3534 owns the U3016k dashboard and idle-time amendments; #3574 owns the removal of cost and tokens and the time chart (U3016e, U3016g, U3016l, U3016m, P14 in `PRINCIPLES.md`).

Policy: this specification PR changes scenarios and `PRINCIPLES.md` only; the implementation PR follows the Contract recipe for the measurement types, read/update interface and every caller, and edits `GLOSSARY.md` and `scenarios/mcp.md` as U3016l lists. roundup computes and shows no cost, price or token counts (P14): Claude Code's own `/cost` and `/usage` already cover them, and no Issue asking for them is built; its answer is P14. Reuse existing observation, Project storage, Event subscription and App seams; add no fourth Adapter seam. No vendor strings, paths or record parsing escape the Adapter. Before new machinery, apply rule 9 and record the library evidence in the implementing PR. No Model, vendor command, prompt, Agent start or settings/Brief/tool-list rewrite is needed to collect or view measurements. No transcript viewer, budget enforcement, scheduler, Workstream nesting or motion is requested.

**U3016a retired.** Measurement collection and storage are removed by #4454 (`scenarios/remove-time-timeline.md`, U4454d); its tests go with the code.

**U3016b retired.** Consumption and money (token totals, reported cost, reference estimates, rate bases, partial-coverage subtotals) are retired by #3574 and P14. Its tests `u3016b_token_totals_reconcile_by_source` and `u3016b_cost_basis_and_missing_coverage_are_explicit` are deleted with the machinery they proved; the once-only counting of a source contribution stays proved for intervals by `u3016a_sources_are_scoped_and_counted_once` and `u3016d_reconnect_reconciles_without_double_counting`.

**U3016d retired.** Measurement collection and storage are removed by #4454 (`scenarios/remove-time-timeline.md`, U4454d); its tests go with the code.

**U3016e retired.** The Time view is removed by #4454 (`scenarios/remove-time-timeline.md`, U4454a and U4454b); its tests go with it.

**U3016f retired.** The Time view is removed by #4454 (`scenarios/remove-time-timeline.md`, U4454a and U4454b); its tests go with it.

**U3016g retired.** The Time view is removed by #4454 (`scenarios/remove-time-timeline.md`, U4454a and U4454b); its tests go with it.

**U3016h retired.** The weekly limit line is gone with the Time view.

**U3016k retired.** The Time view is removed by #4454 (`scenarios/remove-time-timeline.md`, U4454a and U4454b); its tests go with it.

**U3016l retired.** Measurement collection and storage are removed by #4454 (`scenarios/remove-time-timeline.md`, U4454d); its tests go with the code.

**U3016m retired.** Measurement collection and storage are removed by #4454 (`scenarios/remove-time-timeline.md`, U4454d); its tests go with the code.

## Regression checks on main

1. `scenarios/agents.md`, **A20 each launch is one Attempt**, and `crates/agents/tests/scenarios/resume.rs`, `a22_resume_launches_with_resume_flag_and_promotes_on_ack`, `a22_a_failed_launch_rolls_back_to_the_old_node`, `a22_can_resume_survives_a_reopen`: preserve Attempt identity, resume acknowledgement and rollback; measurement replay never starts or resumes an Agent.
2. `scenarios/lean-child-start.md`, **LC13 a specialist at 160k tokens is replaced with a handoff; a job-sized child fits under 160k**: context-size behavior is unrelated to the view, which shows no token count (P14). No monitoring-induced Handoff, replacement or new Model turn.
3. `scenarios/ui-visual.md`, **U130 tokens**, **U137 one module measures the checks**, and `docs/design-system.md`, **The checks**: retain Token ownership and the existing rendered observers. Rule 7's performance limits in `docs/perf.md` remain; implementation records collection/read bounds and a 1,005-contributor observation on #3016 rather than adding a timing test with no real-clock need.

Policy: every behavioral observer named above is an implementation test, not a claim that it exists on main. Keep arithmetic/replay tests at the public read seam with injected sources/clocks; reserve a real Daemon/browser for collection, persistence and user-action claims that those smaller tests cannot prove. No test scans this document to claim feature completion. Changes to Message delivery, Route are outside this measurement capability; any unavoidable change follows the Contract recipe and names M1–M10, keeping the proofs and message documentation in agreement.
