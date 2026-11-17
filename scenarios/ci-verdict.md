# CI verdict time

Module: `.github/workflows/check.yml`, `.github/actions/setup/action.yml`, `apps/desktop/src/testing/shardSequencer.ts`, `loop/affected.py`

Scope: `check` gives a PR its verdict within 5 minutes of the push. Source: #7295, where a web-only PR waited 16 min: each of its 9 web lanes spent 351–375 s in setup and 523–568 s in tests (run 43959571073). It covers the web lanes (#7296), the Rust and macOS lanes and fail fast across lanes (#7298). Inside the web matrix, a failing shard leaves the other shards running, so one run reports every failing web test (L89); only a newer push cancels a run.

**CI7295a web shards by measured time.** Given a PR whose diff selects web tests, when `plan` sizes the web matrix, then it picks the fewest shards, at most `MAX_SHARDS` (the count a full run uses), whose longest measured time, heavy files counted whole, stays within its budget; the number of files decides nothing. A file's measured time is its mean over the full runs `just web-durations` reads, since one run's time swings up to half again, and a shard's parallel files count as two at once, not L89's 2.8: in 24 shards, App files beside Chromium ran no faster (test: `ci7295a_web_runs_get_the_fewest_shards_within_the_time_budget`).

**CI7295b lane time budget on `main`.** Given a web, `rust` or `mac` lane of a `main` run, when its setup takes over 90 s or its test step over 300 s, then the lane fails; when its test step takes over 240 s, it warns. Either way its log names the lane, the step, its seconds and the bound, so timing noise alone never fails `main` (policy; observer: the `CI7295b lane time budget` step of each lane).

**CI7295c web lanes compile nothing.** Given a web lane, when it sets up, then it installs no Rust toolchain and builds nothing: it restores the `rupd`, `rup` and test core that the `daemon` job built once for the run's Rust source tree, and a PR that changes no Rust restores the build `main` saved (policy; observer: the job log, where `daemon` reports a cache hit and the lane runs no `cargo`).

**CI7295d setup waits on no slow step.** Given a hosted Linux lane, when setup frees the runner's disk or installs U26's tracer packages, then each runs in the background; only a job that restores the Rust cache waits for the disk, before the restore, so CI5330e still holds (policy; observer: the job log).

**CI7295f no web test file runs over 100 s.** Given a web test file, when a full run measures it, then it takes at most about 100 s, since no shard ends sooner than its slowest file: a longer file is split by the clauses its tests prove, its tests moved whole and none cut (policy; observer: `apps/desktop/src/testing/shardDurations.json` after `just web-durations` on a full run; #7295 split the nine files over 100 s).

**CI7295e `check` turns red at the first failed job.** Given a `check` run, when any of its jobs fails or times out, then `check` fails within about 30 s, while every other lane runs to its end, so the run's `completed` event hands one fix run every failure; `check` passes only when `lanes`, which needs every lane, succeeds (policy; observer: the run's job list; run 43979217018 failed `check` at 224 s, 8 s after `observers` failed, while `rust 5` ran to 645 s).

**CI7295g a Rust lane builds only its own tests.** Given a `rust` or `mac` lane, when it builds, then it builds only the test binaries its nextest profile selects, plus the binaries those tests start, under `--workspace` so its features match the shared Rust cache, and a profile the diff misses builds nothing (test: the `test_ci7295g_` cases of `loop/affected.test.py`).

**CI7295h the `mac` lane pings only what a PR reaches.** Given a PR, when `plan` reads its diff, then the `mac` lane runs the `rup ping` round trip and the N7/N8 guard observers after it only when the diff reaches the `rupd`, `rup` or `desktop` crates, a crate they depend on, or a file those steps read; every `main` push runs them (test: `test_ci7295h_the_ping_runs_when_the_diff_reaches_a_crate_it_starts_or_a_file_it_reads`).
