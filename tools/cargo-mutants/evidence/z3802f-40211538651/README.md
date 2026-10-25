# Z3802f: drop cargo-mutants 27.1.0 at the total deadline

**Drop:** the PR-diff probe exceeded the strict **below 600 seconds** keep
condition. GNU timeout returned **124 after 600.006783 seconds**, before
report publication. Only **4 of 67** selected mutations completed: **3 caught,
1 unviable, 0 missed, 0 mutant test timeouts**. The other **63 are unfinished**,
not successes. The partial report has no completion timestamp. This is a
whole-run deadline, distinct from a mutant test timeout (tool exit 3).

Work order: #4059; specification: #3802. This is the Shared acceptance's
measured drop alternative. No mutation lint, dependency or production adapter
is adopted. Workflow wiring and its adoption observers are not claimed.
Required gates, main-push behavior, production code, tests and budgets stay
unchanged. No measurement host prerequisite is needed: the probe ran on the
available four-CPU Ubuntu CI host recorded in `host.stdout` and `metadata.json`.

## Workload and outcomes

The workload is merged Rust PR [#4028](https://github.com/roundup-app/roundup/pull/4028),
not a manufactured change. Its exact head is
`ef1c1cea1876b662947bd4a6725f347f2db1263b`; its base is
`d74415ac42b3783937b6d707512d1ee15948dff5`. `pr-4028.diff.gz` retains the
merge-base-to-head, zero-context diff. The selected production mutations are
in `rail.rs` (1), `rail/closed.rs` (32), `rail/settings.rs` (21) and
`rail/view.rs` (13), all in `crates/agents/src/`.

| Probe | Raw exit | Observation | Decision |
|---|---:|---|---|
| Attempt 1 | tool/wrapper 4 | 200.151921 s; baseline failed because the required `rup` CLI had not been built | No keep/drop proof; retain failure and repair setup |
| Attempt 2 | tool/wrapper 1 | 262.075890 s; baseline passed; manually interrupted to enable mutation-compatible lint settings | No keep/drop proof; exit 1 here means observed interruption, not an argument error |
| Attempt 3 | deadline wrapper 124 | 600.006783 s; required binaries built; baseline passed; 4/67 mutations finished | **Drop**, not completion under budget |
| No-Rust PR diff | tool 0 | 2.147839 s; no Rust source changes; zero selected and no target directory created | Build skipped; no keep timing proof |

Attempt 3 builds the CLI and Daemon inside the deadline (18.43 s), then uses
cargo-mutants' supported `--cap-lints true`, `--in-diff`, `--in-place`, nextest
and affected-package tests. Its baseline took 117 s to build and 67 s to test.
The test report retains all 814 tests, retries and 5 existing skips. No shard,
mutant cap, regex, skipped baseline or test filter reduced this workload.
[Strict-lint support](https://mutants.rs/lints.html) lets mutations reach the
tests despite this workspace's denied unused-variable warnings; it changes
no production or required-gate lint setting.

The final attempt reused the earlier attempts' Cargo cache. The toolchain,
nextest and native build dependencies were already installed. Even with
that reuse, binary setup, required builds and mutation testing exhausted the
entire budget before publication could start. Adding checkout, cache restore,
toolchain installation or publication cannot make this observation a keep.
This result applies to this version, workload and supported configuration;
it does not claim every possible future configuration must fail.

The deadline terminated the process group before the shell could record a
natural tool exit. `result.json` records that exit as unavailable, separately
from wrapper 124 and the successful preparation build's exit 0. The partial
`mutants.out/outcomes.json` and original stdout/stderr remain in the archive;
no missing outcome is replaced by a successful default.

## Reproduce and inspect

Use an isolated checkout of the PR head, Rust 1.99.0, cargo-nextest 0.9.149
and the repository's native build dependencies. Set `evidence` to the absolute
path of this directory outside the probe checkout, then run there:

```bash
gzip -dc "$evidence/pr-4028.diff.gz" > "$evidence/pr-4028.diff"
timeout --signal=TERM --kill-after=5s 600s bash "$evidence/probe.command" "$evidence"
```

`probe.command` is the exact retained experiment command, not an installed
CI adapter. It downloads the pinned upstream Linux binary. `release.json`
and the archived `download.sha256` retain matching upstream/archive SHA-256
`dfe6dc37d0342c891d2829b5a695aa57c2d0edecef7e7d0399a30cc6e206411e`.
`input-sha256.json` pins the binary, Cargo manifest/lockfile, toolchain and
nextest configuration. For a cold reproduction, start with an empty target;
for the measured warm state, replay the archived earlier commands first.

Each `attempt-*.tar.gz` contains that attempt's command, timestamps, raw
stdout/stderr, status files and complete available `mutants.out`. `no-rust.tar.gz`
contains its exact PR diff, invocation, output and status. `SHA256SUMS` pins
the archives and diff. Inspect without executing anything:

```bash
sha256sum -c SHA256SUMS
tar -xOf attempt-3-deadline.tar.gz timing.json
tar -xOf attempt-3-deadline.tar.gz mutants.out/outcomes.json
```

The parent CI run is linked in `ci-run.json` and `metadata.json`. Each probe
had its own Worktree; the Builder's working directory and target were never
used for mutation testing. Raw failures and skips remain retained.

## Reuse

Inspected workspace/crate Cargo dependencies and patches, pnpm dependencies,
nextest configuration, the setup action and existing check lanes. Cargo and
nextest already run tests; Git already supplies the merge base and diff.
No installed mutation tool or diff-mutation adapter was found. The probe
uses supported selection/reporting, without a custom parser or selector.

`registry.json` retains crates.io observations dated 2026-10-25:

| Candidate | Release | Total downloads | Decision |
|---|---|---:|---|
| [cargo-mutants 27.1.0](https://crates.io/crates/cargo-mutants) | 2026-06-02 | 787,102 | [Native diff selection](https://mutants.rs/in-diff.html) and [separate outcomes](https://mutants.rs/exit-codes.html) meet the capability need; the measured deadline above drops adoption |
| [cargo-llvm-cov 0.9.1](https://crates.io/crates/cargo-llvm-cov) | 2026-09-06 | 8,657,852 | Its [documented reports](https://github.com/taiki-e/cargo-llvm-cov/tree/v0.9.1) provide line/region/branch coverage, not mutant generation or caught/missed/unviable/timeout detection; rejected for that missing capability |

The [upstream CI recommendations](https://mutants.rs/ci.html) call for a
prebuilt binary and in-place testing; this probe uses both. A future attempt
needs a new measured result, not a relaxed deadline or adjusted baseline.
