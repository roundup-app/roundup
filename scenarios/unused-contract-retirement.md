# Retire contracts with no production caller

Acceptance for #5461. This specification orders a Contract retirement; it does not claim the implementation is delivered. Existing contract generation, Daemon dispatch, App seam and Extension host remain the seams. No new RPC, App command, Hook, storage system or UI is introduced.

## Retired-scenario notes

The retired surface is `attachment.save`, its `attachment::SaveParams` and `attachment::Saved` types and Daemon persistence module; the `rail.list` alias; the App's `imageUrl` command; and `contracts/hooks.ts`. U419's Daemon Save clauses retire in full, following U467's Thread retirement. The surviving pasted-image path is U418's `savePastedImage` / Tauri `save_pasted_image`, not a replacement Daemon method. These notes and U419's retirement note are the only allowed tracked matches for the retired spellings.

Retirement audit: `git grep -n 'attachment\.save\|rail\.list\|imageUrl\|hooks\.ts'` must find nothing outside explicitly labelled retired-scenario notes. Its expected exit codes and interpretation are below.

**C5461a remove the unused surface and migrate every reference.** Given the retired surface above, when implementation lands, then its declarations, handlers, wiring, exports, App adapters and test doubles are absent; all surviving Rail reads use `rail.tree`. The Daemon's method inventory and API descriptions omit the two retired methods, and dispatching either returns the normal unknown-method error. Planned test: `c5461a_retired_methods_are_unknown` in `crates/rupd/src/contract_tests.rs`, using the existing in-process Daemon request seam to assert inventory, descriptions and dispatch refusal. Assemble retired wire names from their namespace and member in the fixture so the source audit below remains exact. Typechecking proves removal from App implementations and contract callers; do not add a source-text test of a removed interface member.

Policy: regenerate `contracts/generated/` using `just contracts` from `crates/contracts`; never hand-edit generated output. Remove the retired type registrations and their generated files. Update all callers, compatibility inventories and type fixtures in the same PR, including `contracts/c4-before.ts`, `contracts/c4-shapes.ts`, MCP inventories and perf coverage/exclusion lists. Remove only the retired entries from compatibility fixtures; keep surviving wire/type assertions. The Contract recipe and rule 4 apply; independent review approves the entire changed surface. Message, Route, Held and Takeover contracts and laws M1–M10 are unchanged. A reference-only edit to `docs/messages.md` keeps it and `proofs/messages` agreeing and follows the existing proof gate.

Policy: remove retired references from live docs, glossary rows and tracked historical RPC capture logs as well as code and tests. Delete an obsolete capture log that names a retired call rather than inventing a replacement recording. Do not remove unrelated captures or regenerate visual evidence for this invisible retirement. Every match from the repository-wide audit defined in the retired-scenario notes must be in an explicitly labelled retired-scenario note. Keep the command in implementation evidence, not a new source-scanning test.

Policy: retire U419's five save/name/uniqueness/invalid-data/expiry tests in `crates/rup/tests/attachment.rs` with their acceptance, and delete the unused Daemon attachment implementation and its startup pruning. Add no migration that deletes previously saved files. Keep U418's native cache, limits, cleanup and Terminal paste observers (Checks 2–3). Replace alias calls in existing Rail, Auto, storage and performance tests with the surviving method; retain their behavior assertions. Apply rule 10 to each edited test file, naming the surviving proof or retired clause for each cut.

**C5461b unsupported Extension events fail registration.** Given a fresh Extension whose `register(on)` first declares a valid action and then calls `on("rail.sort", () => undefined)`, when the real Extension host loads it, then registration fails, no action from that Extension is published, and exactly one `extension.problem` identifies the Extension and names `rail.sort` as unsupported. The Daemon still answers `daemon.ping` and lists a different valid Extension's action. Planned test: `c5461b_unsupported_event_fails_load` in `crates/rupd/src/extensions/tests.rs`, through the existing real Node child/host and socket fixture. The real child is required because failure must cross the runner's registration protocol; a mocked `on` does not prove it.

Given the same registration with any event other than `action`, then it fails with a cause naming that event. Extend the same planned test as a parameterized claim with `agent.status`, `rail.group`, `agent.classify`, `bus.route`, `tool.call`, `ui.render`, `provenance.render` and an unknown event. Policy: the runner rejects every non-`action` event, without an allowlist of unsupported spellings. Existing supported action registration, chaining, permissions and failure isolation remain as Checks 4–5 assert. A bad reload keeps the last good registration under UA7; extend `ua7_a_bad_save_keeps_the_last_good_registration` with an unsupported-event reload if its existing throwing-register case does not already exercise the same failure boundary, rather than duplicating its proof.

Policy: `docs/extension-interface.md` documents only the Hook the host runs: `on("action", {name, label, args?}, hook)` and its existing results, chaining and errors. Trim the Hooks rows to that capability, replace the unsupported-event example, and remove prose implying the removed declarations or other event registrations run. Describe unsupported events as load failures, distinct from UA6's fail-open runtime hook errors. Do not implement new event sources, a replacement Hook SDK or a new Extension runtime.

## Checks retained from main

1. `scenarios/door-terminal.md`, **U467 selecting a Workstream opens its Door's Terminal**, and `scenarios/ui-image-send.md`, **U419 the Daemon saves an Attachment file**: U467 already retired Thread send/feed; C5461a retires the remaining U419 Daemon contract. The retirement does not restore a Thread composer or image viewer (policy).
2. `crates/desktop/src/paste.rs`, `u418_saves_the_bytes_under_a_unique_name`, `u418_refuses_a_type_it_does_not_name`, `u418_refuses_bytes_over_the_limit` and `u418_a_save_prunes_files_older_than_seven_days_and_only_those`: the native pasted-image cache remains the saving authority.
3. `apps/desktop/src/app/u418_save_pasted_image.test.ts`, `u418_the_tauri_adapter_sends_the_bytes_to_save_pasted_image` and `u418_a_refused_save_rejects_with_the_apps_code_and_message`; `scenarios/ui-terminal-paste.md`, **U418 `⌘V` with an image on the clipboard pastes the image's file path, as a File drop does.**: preserve the supported App command and Terminal path, including save errors.
4. `crates/rupd/src/extensions/tests.rs`, `ua1_a_registered_action_is_listed_after_the_apps`, `ua4_a_declared_permission_is_used_and_touched_under_the_ext`, `ua4_an_undeclared_permission_is_forbidden_and_does_nothing` and `ua6_a_throwing_hook_is_skipped_with_one_problem`: supported registration, authority and runtime chaining survive.
5. `crates/rupd/src/extensions/tests.rs`, `ua7_a_bad_save_keeps_the_last_good_registration` and `ua8_a_broken_extension_never_stops_the_daemon`: load failure does not replace a working registration or stop the Daemon.
6. `crates/rupd/src/auto_tests.rs`, `a3308_set_auto_persists_and_emits_once` and `a3308_a_restart_resends_nothing`; `crates/rupd/src/tests.rs`, `r3696c_a_rail_tree_reply_written_directly_equals_the_value_route`: use the surviving Rail method without changing Auto persistence or wire behavior.
7. `justfile`, **contracts-fresh**: regeneration must match committed outputs on the implementation head; a generation failure or output drift fails the observer.
8. `PRINCIPLES.md`, **P13 Named reactions**: the applicable gate asks whether the changed path hides an unsupported event source. The C5461b real-host observer must expose it by name. No reaction engine or Model turn is added. `PRINCIPLES.md`, **P11 Unfinished input**: removing the unused image-view command preserves U418's supported save/paste and failure path; Checks 2–3 are its observers.

## Implementation observer

Run `just contracts-fresh` after committing regenerated output, `just ready`, the added or edited test files and each affected named test above on the implementation PR head. Use targeted `cargo nextest run -p rupd <test names>`, the equivalent targeted `rup`, `agents` or `desktop` tests when their files change, and `pnpm --filter desktop exec vitest run <test files>` for reached desktop behavior. Never run a whole suite. Record the source audit and generator command with their exit codes. Expected script outcomes:

| Command input/result | Exit | Failure evidence |
| --- | --- | --- |
| Source audit with no matches | 1 | None; grep's no-match status is success for absence |
| Source audit with matches only in retired-scenario notes | 0 | None; inspect every returned path and context |
| Source audit with any other match | 0 | Each matching path and text is an acceptance failure despite grep's success status |
| Source audit cannot read the repository | 2 | Git diagnostic; the audit is incomplete |
| `just contracts-fresh`, generation succeeds and outputs match | 0 | None |
| `just contracts-fresh`, generation fails | 1 | Failed generation step |
| `just contracts-fresh`, changed, missing or extra generated output | 1 | Every drift path |

Policy: this is an invisible contract retirement. No rendered UI behavior, Tokens, animation or layout changes; no new Mac-only observation. Linux Daemon/Node tests, contract generation and the existing App/native-save tests prove the named seams. Progress and engineering questions belong on #5461.
