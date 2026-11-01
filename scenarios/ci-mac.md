# macOS pull-request gate

Work order: [#5458](https://github.com/roundup-app/roundup/issues/5458). Module: `.github/workflows/check.yml`; acceptance amendments: S1 (`scenarios/app.md`) and C9b (`scenarios/perf.md`). This specification defines acceptance only; the implementation and its Actions observations remain on the work Issue.

## Checks on main

1. macOS Rust selection and execution: `.github/workflows/check.yml`, `jobs.plan`, `jobs.mac` and its `test-rust` step; `.config/nextest.toml`, `profile.mac`.
2. Packaging and extracted-bundle validation: `.github/workflows/check.yml`, `jobs.mac`, steps `S1 macOS App bundle` and `S1 S3 A12a X8 extracted App bundle observer`; `scenarios/app.md`, S1; `docs/app-bundle.md`, Observe the extracted bundle.
3. Native release-size boundary and evidence: `.github/workflows/check.yml`, `jobs.mac` and `jobs.rust`, steps `C9b native release size` and `C9 native evidence`; `scenarios/perf.md`, C9b.
4. Required result: `.github/workflows/check.yml`, `jobs.check`; `scenarios/loop-rules.md`, L89 parallel CI. A failed required lane cannot yield a passing `check`.

## Acceptance

**CI5458a pull requests keep macOS Rust coverage.** Policy: given a ready pull request whose diff selects Rust tests under Check 1, when its `check` workflow runs, then `mac` runs on `macos-latest` and executes the selected macOS Rust tests with nextest's existing `mac` profile. It skips `C9b native release size`, `S1 macOS App bundle` and `S1 S3 A12a X8 extracted App bundle observer`, together with their release-size and packaging evidence uploads. Missing files from deliberately skipped producers must not fail the PR. `mac` remains a dependency of the required `check`, and failed or cancelled macOS Rust tests cannot pass that result. Keep existing draft and unaffected-diff job selection; keep `mac-clippy`, R24, the daemon smoke test and N7/N8 observers. No test, profile, assertion or workload is removed to meet the time target.

**CI5458b main retains packaging and size gates.** Policy: given a push to `main`, when `check` runs, then `mac` runs its macOS Rust tests, C9b native release-size gate, S1 bundle build and extracted-bundle observer, and retains their evidence uploads. Keep their existing limits, validations and failure behavior, including failure for missing required evidence. S1's packaging and observer cadence and C9b's macOS cadence are `main`, not every PR; Linux C9b cadence is unchanged. Check 4 still rejects a failed or cancelled required lane. No workflow other than `check.yml`, loop machinery or product behavior changes.

**CI5458c a Rust-reaching PR finishes mac in under seven minutes.** Policy: given the implementation PR selecting Rust tests, when its `mac` job completes successfully, then its full job duration is strictly below 420 seconds. Measure job start through completion, including checkout, setup, restore, builds, tests, evidence handling and post-job steps; exclude queue time. If that PR does not select `mac`, observe the next Rust-reaching PR with the implementation on its base. A skipped job, failed job or partial-step sum supplies no timing pass. Record the observed PR, head SHA, run/job URL, start/end timestamps, duration, conclusion and step outcomes on #5458. A duration at or above 420 seconds remains unmet acceptance to investigate without dropping coverage.

## Observers and regression boundary

All three scenarios are policy observations of the real Actions run and required result, not new tests that reread workflow text. For CI5458a and CI5458c, inspect the qualifying PR run; for CI5458b, inspect the first push-to-main run containing the implementation. Record each failed or skipped command separately with its exit code, or its Actions conclusion when no process ran. A missing observation stays open on the Issue; this specification PR claims no timing or gate result.

Applicable Principle: P5's gate asks whether a path writes `main` without green checks. Check 4 remains in force; observe the required `check` result for the qualifying PR and main runs. No App surface, contract, permission, Message law or runtime performance budget changes. Prefer the installed GitHub Actions event/step conditions and existing observers; add no scheduler, clock helper or duplicate gate machinery.
