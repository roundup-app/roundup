# Specialist lookup refuses Agent-supplied start attribution

Acceptance for #5830. Id: A5830. Specification only; the observer below is planned, and merging this file changes no runtime behavior.

## Checks on main

1. `crates/rupd/src/route.rs`, `Daemon::route_inner`: `agent.spawn` with a string `specialist` goes through `Daemon::spawn_specialist` instead of directly calling the Agents module.
2. `crates/rupd/src/specialist.rs`, `Daemon::spawn_specialist`: the cache is keyed by Workstream and specialist name; a live cached row returns without calling `Agents::spawn`.
3. `crates/agents/src/spawn.rs`, `Agents::spawn`: a non-User Actor supplying a non-null `start_attribution` is refused with `FORBIDDEN` before a launch or row write. `crates/agents/tests/scenarios/start_attribution.rs`, `a5765c_agent_attribution_input_creates_and_replaces_nothing`, covers direct creation, not the Daemon's specialist cache.
4. `scenarios/lean-child-start.md`, **LC12 a standing specialist stays alive per Workstream**, and `crates/rupd/tests/lean_specialists.rs`, `lc12_two_lookups_give_one_child_start`: an ordinary repeated lookup returns the existing child and starts nothing.

## Behavioral acceptance

**A5830 A cached specialist does not bypass attribution refusal.** Given an identified Agent in a Workstream and a live standing specialist cached for that Workstream and name, when that Agent calls `agent.spawn` with the same specialist name, `scout: true`, otherwise valid spawn parameters and a valid non-null `start_attribution` object containing `project`, `agent`, `project_name` and `agent_name`, then the call returns `FORBIDDEN`, not a successful cached row. The Rail's row identities, parent relationships, Attempts, Terminal identities and start attribution remain unchanged; no Agent starts or stops. A subsequent call with the same parameters except that `start_attribution` is omitted succeeds with the original specialist id, retains its attribution and starts nothing. Test for every then-clause: `a5830_cached_specialist_refuses_agent_start_attribution`.

Observer: add that focused process-free test under `crates/rupd/src/`, using the real Daemon dispatch with an Agent connection, real stores and seeded live Rail/specialist-cache state. Dispatch both requests through the existing RPC routing seam, observe the error/result and Rail before/after, compare the cached specialist identity, and assert no running-program change. No socket listener, PTY, fake vendor or real Claude is required; the test must fail on main's cached success response, rather than testing only the Agents module or a replacement handler.

## Scope and regression policy

Implementation owns the attribution guard in `crates/rupd/src/specialist.rs` or its existing routing caller `crates/rupd/src/route.rs`, and the process-free regression test plus its module registration under `crates/rupd/src/`. Reuse `SpawnParams`, `StartAttribution`, `Actor` and `RpcError`; add no public type, method, storage, parser or permission setting (policy).

Preserve Checks 3 and 4: ordinary specialist reuse still works, and direct creation still refuses Agent-supplied attribution. This request covers valid non-null attribution on a live cache hit; malformed/null inputs, handoff/replacement behavior and the cross-Project relay remain under their existing acceptance (policy). No Message, Route, Held or Takeover semantics change (policy).

Verification for implementation: `just ready` and `cargo nextest run -p rupd a5830_cached_specialist_refuses_agent_start_attribution`. The test observes the cache path without introducing a vendor launch; CI checks the existing creation and specialist-launch regressions. This specification is verified by `loop/rules.sh vocab`, `loop/rules.sh scenario-ids`, the work-order validator, and review of the numbered main citations and each then-clause's observer.
