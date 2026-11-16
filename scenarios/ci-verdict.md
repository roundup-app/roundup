# CI verdict time

Module: `.github/workflows/check.yml`, `.github/actions/setup/action.yml`, `apps/desktop/src/testing/shardSequencer.ts`, `loop/affected.py`

Scope: `check` gives a PR its verdict within 5 minutes of the push. Source: #7295, where a web-only PR waited 16 min: each of its 9 web lanes spent 351–375 s in setup and 523–568 s in tests (run 43959571073). This file covers the web path; the Rust and macOS lanes follow on the same Issue.

**CI7295a web shards by measured time.** Given a PR whose diff selects web tests, when `plan` sizes the web matrix, then it picks the fewest shards, at most `MAX_SHARDS` (the count a full run uses), whose longest measured time, heavy files counted whole, stays within its budget; the number of files decides nothing (test: `ci7295a_web_runs_get_the_fewest_shards_within_the_time_budget`).

**CI7295b web lane time budget on `main`.** Given a web lane of a `main` run, when its setup takes over 90 s or its test step over 300 s, then the lane fails; when its test step takes over 240 s, it warns. Either way its log names the lane, the step, its seconds and the bound, so timing noise alone never fails `main` (policy; observer: the `CI7295b lane time budget` step of each web lane).

**CI7295c web lanes compile nothing.** Given a web lane, when it sets up, then it installs no Rust toolchain and builds nothing: it restores the `rupd`, `rup` and test core that the `daemon` job built once for the run's Rust source tree, and a PR that changes no Rust restores the build `main` saved (policy; observer: the job log, where `daemon` reports a cache hit and the lane runs no `cargo`).

**CI7295d setup waits on no slow step.** Given a hosted Linux lane, when setup frees the runner's disk or installs U26's tracer packages, then each runs in the background; only a job that restores the Rust cache waits for the disk, before the restore, so CI5330e still holds (policy; observer: the job log).

**CI7295f no web test file runs over 100 s.** Given a web test file, when a full run measures it, then it takes at most about 100 s, since no shard ends sooner than its slowest file: a longer file is split by the clauses its tests prove, its tests moved whole and none cut (policy; observer: `apps/desktop/src/testing/shardDurations.json` after `just web-durations` on a full run; #7295 split the eight files over 100 s).
