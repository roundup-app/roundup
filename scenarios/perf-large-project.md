# Perf: Daemon reads on a large Project

Module: `crates/perf` (a seeded fixture builder and a gate test under `crates/perf/tests/`). Terms: Project, Agent, Rail, Todo, Pad, Daemon (`GLOSSARY.md`). Ids: R5220. Requested in #5220 (refs #5180, #5191). Adds no RPC method, App seam command or token; changes no Daemon behaviour.

**R5220 a Daemon read stays fast on a Project the size of the owner's.** Given a Project the test generates from a fixed seed (written to a temporary directory, never committed) with 300 Agents, each with a Claude Code transcript of 1–5 MB and a few of 50 MB, and a `project.db` of about 800 MB of Todos, Pads and events, when a real `rupd` serves it and every read method in the App's read allowlist (`apps/desktop/src/state/connectedProject.ts`, `reads`) that takes no argument beyond a Project object id is called, and `workstream.setAuto` is called with the same sampling, then:
- alone, each method's p95 over at least 20 calls is under 200 ms;
- while three `rail.tree` calls run at once and again as each finishes, each method's p95 is under 500 ms, and `todo.list` never times out;
- the gate fails with the method name and its p95 when a method exceeds its budget, and a method of the allowlist missing from the sampled set fails the gate by name;
- the gate runs on the CI runner and fails on a `main` that holds the Rail lock across transcript reads (#5180) and passes once #5191 has merged.

Tests in `crates/perf/tests/large_project.rs`: `r5220_every_read_is_under_budget_alone`, `r5220_every_read_is_under_budget_under_three_rail_listings`, `r5220_an_unsampled_read_method_fails_the_gate`. Budgets are rule 7 style limits kept with the other limits in `crates/perf/budgets.json`.
