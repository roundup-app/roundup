# Shared Rust time and retired test code

Source: [#5462](https://github.com/roundup-app/roundup/issues/5462). Id: Z5462. The Issue's deletion inventory is canonical; identifiers being removed are not repeated here so repository-wide absence checks remain meaningful.

**Z5462 one wall clock and no retired helpers.** Given the clock copies, unused helpers and retired selection Message tests inventoried in #5462, when the cleanup lands, the following policies hold. These are source/configuration observations held by review, not new tests that reread source.

- **One clock (policy).** The eight current-time sites in the Issue call one `now_ms` implementation in a crate reachable by all their owners without a dependency cycle. `provenance` must not acquire a dependency on `rpc`. Remove the local clock wrappers, including the differently named Program status wrapper; preserve injected clocks and the existing timestamp units, representation and caller-specific clamping/conversion. Check 1's expression occurs exactly once in Rust under `crates/`, in the shared implementation. The parsed vendor start timestamp in Check 2 is not a clock read: replace its matching conversion spelling with an equivalent library operation, preserving the parsed instant, truncation toward zero and optional failure result; never replace it with the current time. Read installed dependencies/platform facilities and meet rule 9 before introducing clock machinery. Any newly public name follows the Contract recipe and vocabulary rule.
- **Unused code (policy).** Delete the seven unused Door Terminal support functions and the unused conversation-path test method in the Issue's inventory; remove their now-unused imports and the file-level dead-code allowance. A whole-word tracked-source search for each deleted helper identifier has no match. Make the no-argument contract TypeScript renderer private/test-only as needed; retain its caller in Check 3 and the public parameterized renderer used by production. Generated contracts, RPC methods and persisted data remain unchanged.
- **Retired tests (policy).** Apply Check 4's existing U516 retirement: delete the selection Message integration-test binary and the selection excerpt fixture/test from the general CLI integration suite specified in the Issue. Delete code used only by those tests. Stored Messages and general Message delivery remain unchanged. The surviving tests in Checks 5–7 continue to prove already-idle delivery, next-idle delivery and one delivery across repeated idle edges; run each by its existing name. Do not add replacement selection-path tests or redundant source-inventory tests.
- **Real binary references (policy).** Remove references to nonexistent or deleted test binaries from `.config/nextest.toml` and `tools/e14/rust-suites.json`. Every explicit binary identity and every alternative in a binary-name filter in those files resolves to a Cargo test target on the implementation head. Compare against Cargo target metadata/test listing, including library and binary unit-test targets; inspecting filenames alone is insufficient. Keep scheduling/classification of surviving targets unchanged.
- **Verification (policy).** Observe `just check origin/main` on the implementation PR head through CI's existing check lanes. The Builder runs `just ready`, changed test files and the three named surviving delivery tests as its recipe requires; it does not run a whole suite or `just check` locally. Record commands, head and statuses on #5462. All required gates must pass; no skipped or failed observer is a pass.

## Checks on main

1. `crates/messages/src/runtime.rs`, `now_ms`; `crates/agents/src/store.rs`, `now_ms`; `crates/pads/src/operations.rs`, `now_ms`; `crates/todos/src/store.rs`, `now_ms`; `crates/rupd/src/owner_told.rs`, `now_ms`; `crates/rupd/src/program_status.rs`, `wall_ms`; `crates/provenance/src/store.rs`, `Touches::record_revision`; `crates/rupd/src/extensions/mod.rs`, `Host::call` (the `clock` permission branch): existing current-time reads use `unix_timestamp_nanos() / 1_000_000`.
2. `crates/agents/src/claude_code/vendor_list.rs`, `live_rows`: RFC3339 vendor start times use the same division expression, independently of the current-time reads.
3. `crates/contracts/src/methods.rs`, `a38_a_change_to_one_method_rewrites_only_its_line`: the no-argument renderer's test caller and the parameterized renderer's behavioral assertion.
4. `scenarios/ui-terminal-turns.md`, **U516 selection Message delivery is retired**: remove tests/fixtures serving only selection delivery, preserve stored Messages.
5. `crates/messages/src/tests/b_hop_tests.rs`, `b2_a_message_to_an_already_idle_door_is_typed_without_a_new_status`: already-idle delivery.
6. `crates/rup/tests/e2e/wake.rs`, `b42_the_note_goes_through_the_inbox_at_the_next_idle`: pending delivery at the next idle.
7. `crates/rup/tests/e2e/notes.rs`, `b46_thirty_idle_edges_deliver_a_pending_note_once`: repeated idle edges deliver once.
8. `justfile`, `check`, `ready` and `check-rust`: the shared CI observer and Builder's bounded local checks.
9. `crates/provenance/Cargo.toml` and `crates/rpc/Cargo.toml`, `[dependencies]`: `rpc` depends on `provenance`, not the reverse.

## Gates and observers

P1/P9/P10 apply to Message delivery: does the diff introduce a Terminal write, unauthorized prompt or extra turn? Inspect changed callers and run Checks 5–7. P14 applies to vendor parsing: does the diff add usage or money handling? Inspect the changed parser; only its existing start-time conversion is in scope. No launch, UI, Message law, permission or stored-data behavior change is ordered.

## Observation results

Each command/search is reported separately; preserve an unexpected tool failure's actual exit code.

| Observation | Passing result | Failure result |
|---|---|---|
| `grep -rn "unix_timestamp_nanos() / 1_000_000" crates --include='*.rs'` | exit 0, exactly one result in the shared clock | exit 0 with another count; exit 1 (no hit); exit 2 (search error) |
| `git grep -nw -- "$name"`, once per deleted helper identifier from #5462 | exit 1, no matches | exit 0 (identifier remains); any other exit (search error) |
| Cargo target metadata/test listing versus both binary-reference files | listing exits 0; zero unresolved identities/alternatives | nonzero listing exit, or any unresolved identity/alternative |
| Checks 5–7, using the task's targeted nextest commands | each exits 0 | any nonzero exit |
| `just ready` and CI's `check` for the implementation head | each exits 0 | any nonzero exit |

Scope is the files in #5462, the parsed-time conversion in Check 2 (needed for the one-hit acceptance), the shared clock's existing owning crate and caller imports/dependency manifests, and any vocabulary entry required for its public name. No loop machinery changes. Implementation progress and engineering questions stay on the Issue.
