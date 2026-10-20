# Tests keep Project data temporary

Terms: Project, Project data, Daemon, App (`GLOSSARY.md`). Related: N1 (`scenarios/project-data.md`), #749. Acceptance for #1500. Implementation is split by module directory (AGENTS.md rule 3): the desktop test fixture, the native desktop tests, each remaining launch-site owner, and the loop's CI guard ship separately. No production data-path or RPC contract changes.

**N5 the desktop fixture owns its data folder.** Given two real-Daemon fixtures and a seeded App data folder under a temporary home, when each fixture opens, writes a Todo and restarts, then each Daemon receives a non-empty absolute `ROUNDUP_DATA_DIR` owned by that fixture, outside its Project folder; its Todo survives its own restart and appears in neither the other fixture nor the seeded App data (`n5_fixture_data_is_private_and_survives_restart`). Caller environment overrides cannot redirect that data folder to the App data folder (`n5_fixture_rejects_data_redirection`). When startup fails after launch or the fixture stops, then it waits for its Daemon to exit before removing its temporary data folder, and the folder is absent afterwards (`n5_fixture_cleans_data_after_stop_and_failed_start`). The seeded App data's recursive paths and bytes stay equal before and after all cases (`n5_fixture_data_is_private_and_survives_restart`, `n5_fixture_cleans_data_after_stop_and_failed_start`).

**N6 native desktop tests own their data folder.** Given the H18 fixture in `crates/desktop/tests/h18.rs` and a seeded App data folder under a temporary home, when it opens its Project and answers a Decision through the built Daemon, then the Daemon receives a non-empty absolute `ROUNDUP_DATA_DIR` under the fixture's temporary directory and creates Project data there; the seeded App data's recursive paths and bytes remain equal (`n6_h18_data_is_temporary`). When the fixture finishes or fails after launch, then it waits for its Daemon to exit and removes its temporary data folder (`n6_h18_cleans_data_after_stop_and_failure`).

**N7 every test launch keeps data temporary.** Given every repository test, harness and observer that launches the built `rupd`, including shell scripts and CI's ping round trip, when it launches, then it supplies a non-empty absolute `ROUNDUP_DATA_DIR` within a temporary folder owned by that run, never a caller's App data folder (`n7_launch_sites_use_owned_data`). When a run succeeds or fails after launch, then it waits for its Daemon to exit before deleting that folder (`n7_launch_sites_clean_on_success_and_failure`). The audit includes `crates/perf/src/measure.rs`, [U346's executable observer](../docs/evidence.md#u346-executable-observer), the real-Daemon harness recipe and workflow launches; entries that only name a fake executable or open a Daemon in-process are classified separately rather than mistaken for real launches (`n7_launch_sites_use_owned_data`). Policy: N1's explicit fallback observer is the sole exception to setting `ROUNDUP_DATA_DIR`; it unsets it only with HOME and XDG_DATA_HOME pointing inside its own temporary directory, and removes that directory afterwards. Production Daemon launches retain N1's fallback.

Cost observer (TC1): `n7_launch_sites_clean_on_success_and_failure` needs actual child PIDs and reaping across launch, failed startup, failed restart and observer panic; a fake child cannot prove the Daemon exits before temporary data is deleted.

**N8 CI detects an App data write.** Given each `check` job that runs tests or launches a real Daemon (every test runs there), when its test commands execute, then their HOME and XDG_DATA_HOME resolve inside a fresh temporary guard directory; toolchain and dependency locations can remain explicit paths outside it (`n8_guard_wraps_all_test_jobs`). When the commands finish, including a non-zero exit, then the guard checks the macOS `Library/Application Support/dev.roundup.app`, Linux `.local/share/dev.roundup.app` and XDG `dev.roundup.app` locations inside that directory, prints one row per failure and exits as follows (`n8_guard_reports_writes_and_command_failure`):

| Failure | Row | Exit |
|---|---|---|
| Any guarded App data path appears | `App data written: <absolute path>` for each path | non-zero |
| Wrapped command fails | `Test command failed: <exit code>` | non-zero |
| Neither | no failure row | 0 |

An intentionally leaking real-Daemon command fails the guard; an isolated one passes; an already failing command remains a failure even if it writes no data (`n8_guard_reports_writes_and_command_failure`). N1's fallback observer uses a nested temporary home, so it does not exempt any job or suppress the outer guard (`n8_guard_wraps_all_test_jobs`).

Policy: this work deletes none of the user's existing folders, including earlier test-created folders. Cleanup targets only temporary directories created by the current run. No cleanup of the real App data folder is introduced.

## Checks on main

1. `apps/desktop/src/testing/realDaemonFixture.ts:66` launches the built Daemon; its environment at lines 67–74 has no data override.
2. `crates/desktop/tests/h18.rs:50` names its Project `project`; line 66 executes the built Daemon with no data override in the wrapper.
3. `crates/rupd/src/data.rs:18` resolves the data folder; lines 37–43 define the macOS and Linux fallback paths.
4. `crates/perf/src/measure.rs:215` and `:264` launch real Daemons without a data override.
5. `.github/workflows/check.yml:37`, `:56` and `:70` run test commands; line 42 also launches a real Daemon.

R2965 observer requirement for N7: `perf::n7_launch_sites_clean_on_success_and_failure`: run the perf executable's two launch sites with the built Daemon, on success and hook failure; inspect data directories and OS process liveness. A substituted launcher cannot reveal an unreaped actual Daemon or a missing data override at either executable boundary.
