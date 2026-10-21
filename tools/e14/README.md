# E14 full-run observer

`observe.py run` runs one **complete** Linux CI test lane. It keeps the existing
five nextest profiles, four Rust test threads, seven Vitest shards, package tests,
contract freshness check, Chromium fault observer and all configured reporters.
The temporary nextest configuration copies the checkout's entire configuration
and adds JUnit output plus a Nextest run-wrapper for precise timestamps. The temporary web configuration adds one reporter.
No dependency pin, group, filter or scheduler changes.

```text
full lane command
  ├── nextest execution wrapper + JUnit / Vitest worker diagnostics → lifecycle.json
  ├── psutil whole-runner samples             → memory.jsonl
  └── commit, cache state, runner, command     → lane.json
baseline + head (all 12 lanes each)            → compare → report
```

Use a dedicated Linux runner with the same setup as `check.yml` (including its
native packages, headless browser, pinned Node/Rust/Claude/aimock and restored
caches). Never run lanes concurrently on one runner: the runner is the memory
boundary. The observer records whole-machine `total - available` physical memory,
including every simultaneous test child and runner services, **not** maximum
per-process RSS or a sum of child high-water marks. `memory.jsonl` retains the
50 ms samples. The reported peak is the largest observed sample; it is not a
claim of an unsampled kernel high-water mark. Gaps above five seconds fail: a 2-vCPU runner under a full web lane stalls the sampler past one second.
In CI the memory collector starts before the setup action and runs through test
completion, so compilation, dependency installation, cache restoration, browser
warmup and test hooks are covered too. Actions job API timestamps provide full
lane elapsed time; command elapsed time is also retained. Local `run` commands
without `--memory-log` measure the test command interval only. For full-lane
local measurements, start `observe.py memory --output /tmp/e14-memory.jsonl`
before setup, then give that path to `run --memory-log`; the supervisor stops
and joins the collector after the lane command. The collector times out and
fails after 15 minutes rather than surviving a run indefinitely.

For a baseline that predates this helper, retain this directory outside both
checkouts, and invoke its absolute path with each checkout as the working
directory. Use the **same observer revision** on both sides. Install its dependency
once with the Python interpreter used for the commands:

```sh
python3 -m pip install -r /tmp/e14-observer/requirements.txt
cd /path/to/checkout-at-the-exact-baseline-or-head-commit
python3 /tmp/e14-observer/observe.py run --lane rust1 \
  --output /tmp/e14/baseline/rust1 --cache-state 'cold: fresh runner, no restored target or pnpm cache'
```

Run `rust1` through `rust5` and `web1` through `web7`, each on an equivalently
prepared runner, writing `/tmp/e14/baseline/<lane>`. Repeat on head into
`/tmp/e14/head/<lane>`. Replace the example cache description with the actual
preparation or restore hits/misses and keys. Warm and cold measurements are not
interchangeable. Preserve the raw files and command logs from **every** lane.
Fresh output directories are mandatory; an earlier passing observation cannot
survive a failed rerun.

In `check.yml`, each lane uploads `e14-<lane>-<attempt>` even on failure. Main and
workflow-dispatch runs select the full suite. PR runs preserve `$BASE` selection,
record `full: false` and cannot satisfy E14. Artifact directories merge into the
same baseline/head layout. Download full setup logs as cache restore provenance:

```sh
gh run download BASELINE_RUN --pattern 'e14-*' --dir /tmp/e14/baseline-artifacts
gh run download HEAD_RUN --pattern 'e14-*' --dir /tmp/e14/head-artifacts
# Copy each downloaded <artifact>/<lane> directory into baseline/<lane> or head/<lane>.
gh run view BASELINE_RUN --log > /tmp/e14/baseline.log
gh run view HEAD_RUN --log > /tmp/e14/head.log
gh api 'repos/saadshahd/roundup/actions/runs/BASELINE_RUN/jobs?per_page=100' > /tmp/e14/baseline-jobs.json
gh api 'repos/saadshahd/roundup/actions/runs/HEAD_RUN/jobs?per_page=100' > /tmp/e14/head-jobs.json
python3 /tmp/e14-observer/observe.py compare /tmp/e14/baseline /tmp/e14/head \
  --baseline-log /tmp/e14/baseline.log --head-log /tmp/e14/head.log \
  --baseline-jobs /tmp/e14/baseline-jobs.json --head-jobs /tmp/e14/head-jobs.json > /tmp/e14/report.md
```

CI comparisons require setup log entries with cache outcomes and successful
job timings matching the measured run and commit for every lane;
those exact entries accompany the commands and runner identity in the report.
Check the recorded restore keys and hit/miss outcomes for equivalent cache
preparation; a generic CI description alone is not evidence of a warm hit.
Local runs require an explicit cache preparation description instead.

A failed command returns its failure status and preserves raw reports. Missing
reports, missing timestamps, incomplete memory coverage, retries, failed tests,
partial selections, missing lanes, mixed commits, non-equivalent runner images,
or a fifth overlapping real-Claude test fail visibly. The Nextest wrapper brackets the unchanged test command with wall-clock
timestamps; JUnit verifies its result and complete test identity set. Missing,
failed or duplicate wrapper records fail. JUnit rounds timestamps and durations
to milliseconds and can falsely report a fifth overlapping test at a handoff;
no tolerance is subtracted from actual overlaps. Wrapper intervals and Vitest's public worker diagnostics define half-open
intervals; an end and a start at the same time do not overlap. All tests in the
real-Claude Rust binaries (including **B21**) are conservatively counted; web
files referencing model fixtures or `realModel` are counted. Skipped tests have
no execution interval. Hooks before/after tests are not test intervals. The
raw JUnit/web reports retain unsuccessful results even when normalization fails.

Do not call an old successful `check` log a baseline memory observation: the
baseline must be **rerun** with this observer. A report with fewer than 24
complete lanes is rejected. The final #1844 PR needs that measured report;
observer regression fixtures alone do not establish the full-run observation.

```sh
python3 tools/e14/observe.test.py
```

These boundary tests exercise a real Nextest JUnit report and a real failing
Vitest run, reject an intentionally overlapping fifth test, and reject failed
lanes and absent/incomplete evidence. They are not benchmark measurements.

## Reuse

- **Selected:** nextest's [JUnit reporter](https://nexte.st/docs/machine-readable/junit/),
  maintained in [0.9.148, 2026-10-07](https://github.com/nextest-rs/nextest/releases/tag/cargo-nextest-0.9.148),
  supplies complete test identities and results. Its millisecond precision is
  insufficient for exact overlap at handoffs. The same maintained release
  supports [run-wrapper scripts](https://nexte.st/docs/configuration/wrapper-scripts/),
  selected to record precise intervals around the unchanged command. The
  libtest JSON alternative has no per-test wall-clock timestamp contract; its
  buffered events cannot supply execution timestamps. No custom scheduler is added.
- **Selected:** Vitest's [public diagnostics](https://vitest.dev/api/advanced/test-case.html#diagnostic),
  maintained in [5.0.3, 2026-09-30](https://github.com/vitest-dev/vitest/releases/tag/v5.0.3),
  supplies per-test start and duration. Its built-in JSON reporter exports only
  file-level start/end times, so it cannot prove per-test overlap. The small
  reporter template adapts the public API without inventing runner scheduling.
- **Selected:** [psutil](https://github.com/giampaolo/psutil),
  [7.2.2, 2026-01-28](https://github.com/giampaolo/psutil/blob/master/docs/changelog.rst),
  provides aggregate physical memory measurements. No process walker or memory
  parser is added. Neither nextest nor Vitest measures whole-runner physical
  memory or combines both runners' evidence, so the helper only orchestrates
  these existing tools and validates their results.

Rust report identities live in `rust-suites.json`: `real_suites` classifies
concurrency and `required_test_prefix` requires B21 evidence. These are report
references, not launch sites. The observer runs test lanes through
`loop/app-data.py`, which owns their app-data isolation and cleanup. The manifest
is included in the observer revision hashes so comparisons cannot mix classifications.
