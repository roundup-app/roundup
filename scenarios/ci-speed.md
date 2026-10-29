# CI Rust build time

Owner direction: shorten Rust build and cache-restore time; retain a tool only when measured evidence shows a gain. This specification defines implementation acceptance, not a performance result. All clauses below are policy observations except the existing automated performance checks explicitly named below. Measurements belong in the implementation PR body, never a scenario progress table.

## Checks on main

1. Hosted-runner Rust cache and tool installation (`.github/actions/setup/action.yml`, `runs.steps`: `Swatinem/rust-cache@v2`, shared key `check-${{ runner.os }}`, main-only saving, `taiki-e/install-action` for nextest and cargo-machete).
2. Full Rust lane workload, runner class and timeouts (`.github/workflows/check.yml`, `jobs.rust`; `tools/e14/observe.py`, `run` and `compare`). The five partitions use `ubuntu-24.04`; full observations use an empty `BASE`, not PR-selected tests.
3. Spawn-to-first-ping measurement (`crates/perf/src/measure.rs`, `one_run` and `first_ping`; `justfile`, `perf`). The timer already starts before spawning `rupd` and stops after its first successful `daemon.ping` reply; it is not just RPC latency.
4. Absolute and regression gates (`crates/perf/tests/budget.rs`, `r8_the_committed_limits_are_rule_sevens_budgets`, `r8_the_committed_baselines_are_the_recorded_values`, `r9_a_value_at_a_committed_limit_passes_and_the_next_one_fails`, `r9_the_regression_ceiling_is_inclusive_and_exact_at_the_float_edge`; `crates/perf/src/budget.rs`, `judge_all`).
5. Valid performance comparisons and retained failures (`docs/perf.md`, Perf; `scenarios/perf.md`, R13 load-aware comparison and R16 Linux Builder regression observer).
6. Frozen machinery and tool reuse (`AGENTS.md`, The loop and Rules 7, 9 and 10). The freeze lists `.github/workflows/` except `check.yml`, not `.github/actions/`.

## Acceptance

**CI3781 measured Rust CI changes.** Given the unchanged Rust lane and runtime budgets in Checks 1–5, when cache, linker or timing tools are evaluated, then the following observations decide adoption.

### Baseline before changes (policy)

Before changing cache or linker configuration, publish the baseline PR-body rows: a fresh hosted runner with no matching Rust cache, followed by a fresh runner restoring the saved main key. Record the actual key, hit/miss, archive bytes and cache producer commit; never delete or overwrite the shared main cache to create a miss. Use isolated experimental cache storage if needed and document how its contents match the production case. Missing cache access or runner capacity is an engineering prerequisite, not a zero-duration measurement.

Measure all five full Rust partitions, with the same tests, profiles, thread counts, toolchain, lockfiles and release settings before and after. Record runner OS/image version, architecture, CPU model/count, memory, commit, run/job URL, exact commands, tool versions and cache preparation. Compare only matching runner classes and cache states. Existing E14 output and Actions job/setup logs are the first source; a local command duration is not a full CI lane duration.

Record separately, in minutes:

| Interval | Start → end |
| --- | --- |
| Cache miss | Cache lookup starts → miss returns; no restore transfer occurred |
| Cold restore | Restore of a saved entry starts on a fresh runner → archive download and unpack complete |
| Build | Cargo starts → all requested binaries are built |
| Link | Linker starts → exits successfully, for the same target/profile; record how this subinterval was observed |
| Full lane | Job starts → job completes, including setup, installation, restore, build, tests and evidence upload; exclude queue time |

The reported 16 minutes and 726 MB are hypotheses to verify, not acceptance targets or measured baselines. Do not label total setup or recompilation as restore time. First publish the baseline, then a numerical restore/full-lane target derived from it, before candidate runs.

### Comparison and retention (policy)

Use at least three successful observations per side and cache state, retaining every sample, failure, timeout and skip with its exit code. Compare medians; show range and percentage change. A gain means a strictly lower median for the row's named metric under the same workload and conditions. A tie, missing result, unmatched cache state, failed gate or skipped required comparison supplies no gain. Evaluate each candidate separately against the base case, then repeat the final combined configuration; a candidate's gain must survive in that final configuration.

| Candidate | Comparison and condition for keeping it |
| --- | --- |
| `sccache` alongside `Swatinem/rust-cache` | Cold saved-key restore and full-lane medians both fall; disclose both caches' restore times/bytes, hit/miss statistics, wrapper settings and install/save overhead. Also report the empty-cache lane, so a warm hit cannot impersonate a cold improvement. |
| `mold` on hosted Linux only | Link and full-lane medians fall for the same binaries/profile, including installation overhead in the lane; record actual linker invocation rather than assuming the previous linker was `ld`. |
| `hyperfine` spawn-to-first-ping observation | Same-host reference/head startup medians fall, confirmed by the unchanged `just perf` observer. Benchmark identical commands against both binaries; a different timer alone is not a runtime gain. Use it for the experiment, then remove any persistent installation/integration unless this row shows a gain. |

Every implementation PR has before/after rows for cold restore and every full Rust lane, plus each candidate's metric, gain and kept/removed decision. Remove a candidate with no gain in that PR, including its installation, cache, environment and linker configuration; name it as removed. If all candidates fail, the measured rejection report completes the experiment without installing them. Do not remove existing checks, reduce workloads, relax timeouts or change runtime budgets to obtain a gain. Keep the final configuration only when its reported target is met and no full lane's median increases.

### Runtime and runner isolation (policy; existing automated gates)

Keep `just perf` and its complete workload, reports and exit behavior. The existing tests in Check 4 continue to prove the absolute and regression boundaries; `r2_a_value_eleven_percent_over_its_baseline_fails` in `crates/perf/tests/budget.rs` proves rejection above 10%. Keep the entire `cold_start_ms` budget unchanged: limit 300 ms, macOS baseline 7.1 ms, noise 0.3 ms and load threshold 0.45 per CPU. Preserve every other budget, R13's load qualification and R16's machine qualification. A skip is not a regression pass.

Run the same reference/head release `just perf` observer on one host in one session, with eleven fresh Daemons per invocation, separate reports and identical commands. For hyperfine, use eleven measured fresh starts per binary and retain raw samples and the exact readiness command. Stop timing at the first successful ping, not socket creation or process exit; keep teardown outside that interval. Preparation and cleanup use only temporary Projects/data/sockets and run-owned processes. Failed readiness, cleanup or invalid sampling invalidates that observation. A whole `just perf` invocation includes unrelated metrics and cannot be the hyperfine startup command. Preserve all reports, loads, errors and exit codes. Unsupported hardware is a measurement prerequisite, never permission to weaken qualification.

No cache or linker change executes on `runner.environment == 'self-hosted'`: keep existing `runner.environment != 'self-hosted'` guards, apply them to candidate installation/configuration and do not add repository-wide linker/wrapper defaults that bypass them. Keep macOS linker selection unchanged. Check 6's frozen paths stay unchanged; `.github/actions/setup/action.yml`, job-local hosted settings in `check.yml`, and conditional Cargo settings are eligible surfaces. There is currently no `.cargo/config.toml`; any new one must preserve local and self-hosted behavior. Review the effective settings for hosted Linux, hosted macOS and self-hosted runners (policy), not just the presence of guard text.

### Build profile and reuse report (policy)

Use Cargo build timings from the unchanged cold compilation to select the three packages with the greatest summed compilation-unit wall time, recording the units/profile/features and ranking rule. Run `cargo-llvm-lines` once for each of those packages outside the timed lane; report package, build seconds, total LLVM IR lines, monomorphization copies and largest contributing functions in the PR body. IR line count is diagnostic, not a substitute for build time. An unsupported package/target is a failed observation to repair or scope as a prerequisite, never silently replaced by the fourth package. Commit no llvm-lines report and add no recurring profiling job.

The implementation PR's `Reuse:` section records dated stars and latest release links for `mozilla/sccache`, `rui314/mold`, `sharkdp/hyperfine`, `dtolnay/cargo-llvm-lines` and the installed base case `Swatinem/rust-cache`. Inspect installed dependencies and platform features first. Prefer Cargo timings, existing E14/Actions evidence and the current perf observer over new machinery. Compare at least two maintained candidates for any added helper under rule 9; state a specific capability/size/licence/measurement/maintenance reason for rejection. `taiki-e/install-action` already supplies prebuilt nextest and cargo-machete: no `cargo-binstall` adoption without a remaining install it improves.

## Completion boundary (policy)

The specification completes when this acceptance is on main and the separate implementation work order is natively blocked by its specification Issue until that merge. The implementation completes only with the measured PR-body tables, retained/removed decisions, llvm-lines table, unchanged performance gates and effective runner isolation above. Specification prose supplies no speedup claim. Issue dependencies, progress, runner prerequisites and unresolved engineering questions live on GitHub Issues.

## Experiment cache names

**CI4018 comma-safe experiment caches.** Given a hosted Linux pull request opted into CI3781 by the exact title prefix `CI3781 experiment: `, when its experiment cache namespace is derived, then the complete primary and restore keys supplied to the cache action contain no comma and are at most 512 characters. The title `CI3781 experiment: a,b` remains opted in; rejecting the title, skipping caching or falling back to the shared main cache does not satisfy this clause.

For unchanged cache inputs (toolchain, lockfiles and cache version), pushes to the same PR with the same complete title produce the same keys. Changing the title or PR number selects a different experiment namespace. In particular, `CI3781 experiment: a,b`, `CI3781 experiment: ab` and `CI3781 experiment: a-b` remain distinct; dropping or replacing punctuation must not merge their caches.

Automated observer: `ci4018_experiment_titles_keep_valid_distinct_cache_keys` executes the production namespace derivation for those three titles, a repeated invocation with another head SHA, and the same title under another PR number. It asserts cache-key validity, repeat equality and namespace separation above. Exercise the value passed to the cache action, including its added prefixes and restore keys; a test that only rereads workflow text or tests an independent copy of the derivation does not prove this scenario.

### Hosted cache observer (policy)

On a fresh hosted Linux runner, run the comma-bearing title with an unused experiment namespace and let the existing full-workspace producer save its entry. Push again without changing the title or cache inputs, then observe a fresh runner restoring that saved experiment entry. Both runs complete cache setup without a key-validation error or warning; the first records a miss and a successful save, and the second records a hit on that entry. A green lane that skipped or failed caching is not a pass. Retain run/job URLs, source and producer SHAs, exact title, actual primary/restore/matched keys, hit/miss, archive bytes and commands with exit codes. Each failed or skipped command has its own evidence row and exit code.

### Regression boundary (policy)

Keep CI3781's full Rust experiment workload and observer enabled for comma-bearing titles. Ordinary PR titles and non-PR events retain their existing cache selection and save rules; hosted macOS, self-hosted runners and local builds retain their existing behavior. Experiment entries remain separate from shared main entries and other PR experiments; never delete or overwrite shared caches to observe a miss. Checks 1, 2 and 6 remain in force. Observe the effective settings on each path, rather than only checking guard text. No candidate tool, workload reduction, gate change or performance claim is part of this repair.
