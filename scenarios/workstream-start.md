# Start a Workstream's Door by Rail name

Acceptance for [#4700](https://github.com/roundup-app/roundup/issues/4700). Extends A7 (`scenarios/agents.md`) to Workstream-name inputs of `rail.startDoor`, exposed as `rail_startDoor` through MCP. The Workstream's id remains its Door's canonical identity. This is a Workstream selection, including before its first Attempt, not an expansion of U4593's Agent-only selection (policy).

**A4700a a newly created Workstream starts by Rail name.** Given an authorized caller and a fresh Project, when it calls `rail_createWorkstream {name: "todo-pad-views", parent: null}` and immediately calls `rail_startDoor {id: <selector>}`, then both `"todo-pad-views"` and `"name:todo-pad-views"` select that created Workstream and start its Door. Run each selector against a fresh fixture whose Workstream has no Attempt or Terminal before the start. The successful result identifies the created Workstream, and `rail.tree` and `terminal.list` show its live Door using that same identity and the returned Terminal; no replacement Workstream is created. Planned test: `a4700a_a_new_workstream_starts_by_rail_name`, parameterized by these two selectors.

**A4700b starting by id remains supported.** Given the same create-then-start sequence in a fresh fixture, when `rail_startDoor` receives the canonical id returned by `rail_createWorkstream`, then it starts that Workstream's Door with the same identity and live-Terminal guarantees as A4700a. Planned test: `a4700b_a_new_workstream_starts_by_id`.

**A4700c an unknown Workstream name is reported as that name.** Given a Project containing the newly created, unstarted Workstream `todo-pad-views` and no Workstream named `missing-workstream`, when the caller invokes `rail_startDoor` with `id: "missing-workstream"` or `id: "name:missing-workstream"`, then it receives an MCP error containing `missing-workstream`, not `an Agent that is gone`; the underlying RPC error is `NOT_FOUND`. The Rail, Attempts and Terminals remain unchanged. Planned test: `a4700c_an_unknown_workstream_name_is_named_without_starting`, parameterized by the two selectors, checking the public MCP error, RPC code and before/after state.

## Observer

Implement the three named tests in the existing `crates/rup/tests/mcp/names.rs` suite (or a focused test module registered by `crates/rup/tests/mcp.rs`). Drive the production MCP handler, Daemon routing, Rail store and Door launch with the existing isolated fake-vendor fixture. Success must observe a real fake-vendor launch and live Terminal, not a recorded RPC or seeded success. The scenario names a launch, so a fake vendor process and PTY are required; no real vendor, browser, native App or Mac observation is required. Reuse the existing bounded launch observer and clean up only the fixture's processes (policy).

Verification command for implementation: `cargo nextest run -p rup --test mcp -E 'test(a4700)'`. Keep each case under five seconds on CI; retain existing A7 lifecycle coverage rather than repeating stop/restart/timeout cases here (policy).

## Selection and authority boundary

Resolve from the connected Project's current Rail before the existing `rail.startDoor` Reach guard and launch. Exact, case-sensitive Workstream names are accepted even when their Door has never started. Preserve canonical-id precedence and `name:`'s explicit-name precedence; do not select an Agent node as a Workstream, guess an ambiguous name or search another Project. Keep the existing Reach, Role, launch, Model and Effort rules. These are implementation constraints (policy); A4700a–c assert the requested regression. This specification adds no RPC, type, persistence format or vocabulary and changes no Message, Route, Held or Takeover semantics (policy).

## Checks on origin/main at specification time

These are numbered baselines, not evidence the planned tests pass:

1. `crates/contracts/src/declarations.rs`, `declarations!`, declares `rail.createWorkstream` and `rail.startDoor` and exposes their MCP tools. Keep those public methods and Role exposure.
2. `crates/rupd/src/auto.rs`, `Daemon::route`, calls `Daemon::resolve_agent_inputs` before dispatch. `crates/rupd/src/selectors.rs`, `Daemon::resolve_agent_inputs`, lists the fields it resolves; `is_agent` excludes a Workstream without an Attempt. Workstream starts need selection that includes never-started Workstreams without broadening Agent-only selectors.
3. `crates/agents/src/dispatch.rs`, `Agents::rpc_rail_start_door`, applies `Shared::guard_reach` and starts the Door. `crates/agents/src/reach.rs`, `Shared::guard_reach`, first looks up the supplied id. `crates/agents/src/door.rs`, `Agents::start_door_with`, checks the Workstream kind and launches or resumes its Door. Preserve these guards after canonicalization.
4. `crates/rup/tests/mcp/names.rs`, `m2706a_actions_name_rail_nodes`, exercises public MCP against the real Daemon; `crates/rupd/src/workstream_door.rs`, `a7_b1_b9_real_daemon_fences_old_status_after_door_restart`, observes Door identity and Terminal liveness through that Daemon. Reuse their seams, not a new registry or protocol.

## Principle gates and journey

P1: does name selection prevent starting work through its Workstream or remove direct Agent access? Observe A4700a/b through MCP with the original Workstream/Door identity. P4: does resolution inspect vendor details outside the Adapter? Resolve only Rail state; the fake vendor observes the existing launch. P9: can a failed name selection start a program? A4700c observes no new Attempt or Terminal. Each gate must answer no (policy).

Journey stage: Request (`.agents/data/journey.md`): an Agent creates a Workstream and starts its Door through the real tools. This specification concerns the tool path; it claims no rendered or native-App change and leaves the journey's rendered observer intact (policy).
