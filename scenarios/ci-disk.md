# CI runner disk

Module: `.github/workflows/check.yml`, `.github/actions/setup/action.yml`, `tools/e14/`

Scope: no `check` job that starts a browser, and no `rust 1`, runs its runner out of disk. Source: #5330, where four web jobs died with `No space left on device` writing the runner's `_diag` log, each failing `main` with no test failure. The `ubuntu-24.04` runner has about 14 GB free at start.

**CI5330a every browser lane logs its disk use.** Given a `check` job that starts a browser (`web`, `chromium`), when it runs, then its log holds `df -h /` before its first test step and after its last, and the end reading runs even when a step failed (policy; observer: the job log).

**CI5330b a test file leaves no browser state behind.** Given a web test file that starts an `agent-browser` session or Chromium, when the file ends, then the profile directory, captures, traces and screenshots it wrote are removed, so what a shard keeps is bounded by one file's output, not the sum of the shard's files (test: a Vitest case beside the test setup that runs a file's teardown and asserts the directories it created are gone).

**CI5330c a full web shard ends with room.** Given a full `all` run on a CI runner, when a web shard's test step ends, then its end-of-job `df` shows at least 4 GB free (policy; observer: `df -h /` of CI5330a in every web shard of a full run on `main`; a shard below 4 GB is a failure whatever its tests did).

**CI5330d the largest writers are named.** Given a shard whose end reading is below 4 GB, when the cause is sought, then the job log lists the sizes of the directories the tests write (browser profiles, `target/`, the pnpm store, Vite caches, captures), so the growth is attributed without a rerun (policy; observer: the job log).

**CI5330e `rust 1` fits the small runner image.** Given `rust 1` on `main`, which builds the release `rupd` and every test target, when it lands on the 72 GB `ubuntu-24.04` image, then it ends without `No space left on device` or a linker bus error (policy; observer: the job log, where `disk.sh free` logs the room left; runs 41338819073 and 41341444919 failed it with 27 GB free).

**CI5330f every `rust` lane logs its disk use.** Given a `rust` lane of `check`, when it runs, then its log holds `df -h /` and the CI5330d sizes before `test-rust` and after its last test step, and the end reading runs even when a step failed (policy; observer: the job log; run 41354050370 lost `rust 2` to `No space left on device` after #5504, with no record of what filled the disk).
