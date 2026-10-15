# Perf

Rule 7's budgets and what measures each. Linux VM numbers are Linux numbers. The macOS baseline was recorded on a laptop in ordinary use (load 4 to 7 on 16 cores, 0.25 to 0.45 per core), not an idle one, so it is a baseline for that machine under that load.

| Budget | Measured by | Where |
|---|---|---|
| Daemon cold start < 300 ms | `just perf` (`cold_start_ms`: spawn `rupd` to its first `daemon.ping` reply) | any machine; the App's cold start to a visible window is manual |
| Cold plugin materialization < 300 ms | `just perf` (`cold_plugin_materialization_ms`: pinned Q11 plugins into fresh empty storage) | any machine; 10% regression against its recorded Linux baseline |
| 10 idle Agents < 150 MB extra RSS | `just perf` (`rss_extra_mb`: the Daemon's growth with ten login-shell Terminals) | any machine; the Agents' own processes are manual |
| Keystroke-to-render < 16 ms p95 | `just perf-keystroke`, only when the user asks (below) | the macOS App only |
| Regression above 10% fails | `just perf` against `crates/perf/budgets.json` | same OS as the baseline |
| 100-tool-use loop's hook-process cost stays within a fixed limit | `just perf` (`hook_loop_ms`: 200 `rup signal` calls against a fresh Daemon, H15) | any machine; limit-only, no regression ceiling |

**H15's hook cost.** `rup signal` cost 3.8 ms wall and 4.3 ms CPU per call on architect-swarm's Mac before H15 (read by hand, not committed), about 760 ms wall for the 200 calls (`PreToolUse` and `PostToolUse`) a 100-tool-use loop makes. The replay rule in `crates/agents/tests/state_events.rs`, which also replays each fixture's titles and compares the whole Status, finds no event in `STATE_EVENTS` prunable: `PreToolUse`'s Signal is what lets A2's star hold (`crates/agents/src/claude_code/mod.rs`) tell a star that may precede a dialog from one that may not. `STATE_EVENTS` keeps all nine events and a tool use still costs two `rup signal` calls. The one saving is a current-thread runtime in `crates/rup/src/main.rs`, so `rup signal` runs one OS thread (`h15_rup_signal_never_runs_more_than_one_os_thread`, `crates/rup/tests/signal.rs`). `hook_loop_ms` is the wall time of 200 sequential `rup signal` calls against a fresh Daemon; it is limit-only, with no baseline and no R13 skip. Its `limit` of 2000 ms is a gross tripwire, not a saving: the figure was read by hand and is not committed. The end-to-end check, with the real settings `agent.spawn` writes, is `h15_every_hook_call_of_a_hundred_tool_use_loop_is_answered_and_the_final_stop_leaves_the_agent_idle` (`crates/rup/tests/e2e.rs`).

`just perf` runs a fresh Daemon 11 times, takes each metric's median, prints the range and each run's load average, writes `target/perf.json` and exits 1 on a miss. Run it on a quiet machine: load is printed so a noisy run can be thrown away. A metric fails above its `limit`, or above its OS's `baseline` by more than 10% plus its `noise` allowance.

**Q11's cold plugin materialization.** Each release `perf` run materializes the pinned plugin bundle into a new empty temporary directory. Only `plugins::materialize` is timed; `bundle.validate()` must then succeed or the observer exits 2. The median is printed as `cold_plugin_materialization_ms` and retained in `target/perf.json`. Its rule 7 limit remains 300 ms on every OS at every load. Regression above the recorded Linux baseline by more than 10% plus the clock-resolution allowance fails (exit 1), using the same R13 load rule as other latencies. `just check` verifies empty-directory materialization and validation without a wall-clock assertion (`q11_cold_materialization_produces_a_valid_bundle`).

Q11's Linux baseline is 11.940635 ms, the median of nine eleven-sample release observations on 2026-10-14 (Ubuntu 24.04, four available CPUs, AMD EPYC 7763 64-Core Processor, rustc 1.99.0). The nine medians were 11.889899, 11.971422, 12.378832, 11.931701, 11.680185, 11.874712, 11.944743, 11.940635 and 12.034941 ms (max/median 1.037, min/median 0.978); median load per CPU was 0.60–1.20. The probe is commit `9ff3cf3e` in [#1762](https://github.com/saadshahd/roundup/pull/1762); this baseline applies to that Linux machine class, not macOS. The clock-resolution allowance is 0.001 ms, and R13's Linux threshold is 2.0 load per CPU. The 300 ms hard limit applies even when load skips the regression comparison; macOS has the hard limit until its own baseline is measured. Tests `q11_cold_plugin_materialization_keeps_the_300_ms_limit`, `q11_cold_plugin_materialization_rejects_a_release_regression_below_the_hard_limit` and `q11_perf_reports_cold_plugin_materialization_and_fails_an_over_budget_median` exercise the gates with synthetic samples, never clock assertions.

## What is enforced, and what is not

Rule 7's 10% regression test is enforced for six metrics on Linux (including Q11) and five on macOS (below) — except that a time metric's regression test is skipped, loudly, when the machine is busier than its baseline's load (R13) — and is a gross tripwire for the rest. A latency miss on macOS is rerun on a quiet machine before it is believed. Measured on an isolated 2-vCPU boxd VM (AMD EPYC, load 2 to 4 from the runs themselves): 9 invocations of 11 runs each, the spread of the 9 medians against their median was

| Metric | max / median | min / median | Gate |
|---|---|---|---|
| `rss_extra_mb` | 1.05 | 0.93 | 10% + 0.05 MB |
| `ping_p95_ms` | 1.13 | 0.96 | 10% + 0.001 ms |
| `rail_tree_40_p95_ms` | 1.06 | 0.97 | 10% + 0.001 ms |
| `terminal_write_p95_ms` | 1.04 | 0.88 | 10% + 0.001 ms |
| `write_to_output_p95_ms` | 1.09 | 0.96 | 10% + 0.001 ms, limit 16 ms |
| `cold_start_ms` | 3.08 | 0.57 | limit 300 ms only: its median varies 3x between identical invocations, so no 10% test can hold |
| `rail_tree_10_p95_ms` | 1.66 | 0.51 | limit 2 ms only (about 8x its median): same reason |

`noise` is an absolute floor for the clock's resolution, not slack: it is 0.05 MB on a 1.6 MB metric and 1 microsecond on latencies of 25 to 265 microseconds. The worst observed ratio (1.13, `ping`) is a 0.5 microsecond overshoot that the floor covers; with only 9 invocations, one false fail in a few dozen runs is expected, so rerun before believing a single fail. The `linux` baselines are the medians of those 9 invocations and are valid for that VM class only. The `macos` baselines are in the next section; the `limit`s hold anywhere. To accept a new baseline, copy the medians from `target/perf.json` into `budgets.json` under the OS name in the same PR that explains why. See `scenarios/perf.md` (R1 to R10).

## Linux Builder classes (R16 specification)

R16 supports five distinct Builder identities. All require `ID=ubuntu`, `VERSION_ID=24.04`, architecture `x86_64`, online CPU set `0-3`, four available CPUs and unrestricted affinity `0-3`:

| Class | Exact CPU model | Baseline and provenance |
|---|---|---|
| Builder 9V45 | `AMD EPYC 9V45 96-Core Processor` | Measured on 9V45 only |
| Builder 7763 | `AMD EPYC 7763 64-Core Processor` | Measured on 7763 only |
| Builder 9V74 | `AMD EPYC 9V74 80-Core Processor` | Measured on 9V74 only |
| Builder 8573C | `INTEL(R) XEON(R) PLATINUM 8573C` | Measured on Intel 8573C only |
| Builder 8370C | `Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz` | Measured on Intel 8370C only |
| boxd | Historical two-vCPU VM | Existing boxd values and provenance retained separately |

Record host identity with these commands in the same process environment as the observer; keep the full output with every measurement report:

```sh
cat /etc/os-release
LC_ALL=C lscpu
cat /sys/devices/system/cpu/online
nproc
sed -n '/^Cpus_allowed_list:/p' /proc/self/status
uname -a
rustc -Vv
cargo -V
printf 'SHELL=%s\n' "$SHELL"
```

`nproc` reports available CPUs; the online set and process affinity must both be `0-3`. Compare the parsed distribution, version, architecture and full CPU model for exact equality; do not match an EPYC or Xeon family prefix. Record release toolchain/build settings, login-shell workload and binary hashes with the reports as R16 requires. Kernel and shell differences are diagnostic metadata, not CPU identity. CPU affinity or CPU-count rescaling cannot convert boxd, 7763, 9V45, 9V74, Intel 8573C or Intel 8370C into one another.

The identity evidence in #1266 records a 9V45 Builder at `7922b6f225452fc4da68396d7d75b4ed0054fa74`; it establishes the supported identity, not performance. A 7763 report cannot establish a 9V45 baseline even with identical Ubuntu and CPU counts. An unknown identity, any missing required identity field, or a supported identity without its measured baseline and provenance is an observer error (exit 2), naming the mismatch or missing input. It cannot reuse another class's values or report a clean pass. R16 assigns selection/report metadata to `r16_builder_selects_its_measured_class` and these rejections to `r16_unknown_or_incomplete_linux_class_is_an_observer_error`; these are implementation obligations for all five Builder identities.

The identity evidence in #1303 records an Intel 8573C Builder at `ab349a1d5f46d0dce3c6d51a0a0f8617311c4669` on 2026-10-12: Ubuntu 24.04, x86_64, online CPUs and affinity `0-3`, four available CPUs, kernel `6.17.0-1022-azure`, rustc `1.99.0 (b940084d7 2026-09-28)` and cargo `1.99.0 (5f94df478 2026-08-27)`. This records identity only; AMD measurements establish no Intel baseline.

The identity evidence in #1313 records a 9V74 Builder at `2ae44989f5ec68a2c9021a381f5f2eae8cbb63ff` on 2026-10-12: Ubuntu 24.04 (`ID=ubuntu`, `VERSION_ID=24.04`), x86_64, exact CPU model `AMD EPYC 9V74 80-Core Processor`, online CPUs and affinity `0-3`, four available CPUs, kernel `6.17.0-1022-azure`, rustc `1.99.0 (b940084d7 2026-09-28)`, cargo `1.99.0 (5f94df478 2026-08-27)` and shell `/bin/bash`. This records identity only. No other CPU class can establish its baseline or provenance.

The identity evidence in #1941 records an Intel 8370C Builder at `06fd4eb7e24c476b104e52b94e78fa491d2f47f4`: Ubuntu 24.04.5 (`ID=ubuntu`, `VERSION_ID=24.04`), architecture `x86_64`, exact CPU model `Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz`, online CPUs `0-3`, four available CPUs and process affinity `0-3`. Diagnostic metadata: kernel `6.17.0-1022-azure`, rustc `1.99.0 (b940084d7 2026-09-28)`, cargo `1.99.0 (5f94df478 2026-08-27)` and shell `/bin/bash`. This is identity evidence only; its standalone preflight exit 2 is a qualification failure, not a `just perf` result or latency observation. No Daemon/probe build, timing or benchmark failure is claimed. No other CPU class establishes its baseline or provenance, including Intel 8573C.

#1266, #1303, #1313 and #1941 specify identities only; the Intel specification PR closes #1303 when its specification acceptance holds and the 9V74 specification PR uses `Refs #1313` and closes #1313 only when its specification acceptance holds; the 8370C specification PR uses `Refs #1941` and `Closes #1941` only when its specification acceptance holds. #1366 stays open for same-host Message latency evidence, #1361 for final combined latency acceptance and #1251 for observer implementation, independent calibration and completion observations. Measurement policy: for each newly measured class, including 9V74 and 8370C independently, R16 requires historical/current same-host diagnosis with nine alternating invocations of eleven fresh Daemons per reference, compatible identical probe bytes and isolation of probe changes using the same binaries, nine clean calibration invocations only after regression diagnosis and repair, then three separate clean eleven-Daemon observations on the implementation head with the baseline fixed. Retain every report, per-run metric and load, failed observation and repeat, exit code, reference commit, binary hash and exact command; retain and repeat busy invocations rather than counting them as clean. Diagnose and repair Daemon or probe regressions before accepting a baseline. This identity amendment supplies no evidence that either regression is absent.

R1–R15 and R8's pins remain unchanged, as do ten login shells, all measured calls, #1366's historical write ceilings and #1361's final combined acceptance. Every class keeps all absolute limits, 10% plus existing noise, Linux's load threshold of 2.0 per CPU, memory comparisons at every load and loud latency skips. A skipped latency comparison cannot complete R16, even on exit 0. No automatic baseline generation, removed metric, widened allowance, baseline increase to hide a regression or CPU-count rescaling is permitted. The implementation pins each class's values, provenance and thresholds in R8's tests; see R16 for test names and the failure/exit table.

## macOS baseline

Recorded on one Apple M4 Max laptop (16 cores); the key is the OS only, so the numbers are valid for that machine class: `macos-latest` in CI or a slower Mac would be judged against an M4 Max and needs its own baseline before it is gated. The machine was in ordinary use, not idle (a developer's laptop is never idle). Its load average was 4 to 7, which is 0.25 to 0.45 per core. The baseline is 9 invocations of 11 runs each. The spread of the 9 medians against their median:

| Metric | max / median | Gate on macOS |
|---|---|---|
| `cold_start_ms` | 1.07 | 10% + 0.3 ms, limit 300 ms (Linux: limit only) |
| `rss_extra_mb` | 1.01 | 10% + 0.05 MB, limit 150 MB |
| `rail_tree_40_p95_ms` | 1.07 | 10% + 0.001 ms |
| `terminal_write_p95_ms` | 1.09 | 10% + 0.001 ms |
| `write_to_output_p95_ms` | 1.09 | 10% + 0.001 ms, limit 16 ms |
| `ping_p95_ms` | 1.19 | none: 4 microseconds of jitter on 24 is 19% |
| `rail_tree_10_p95_ms` | 1.19 | none: same |
| keystroke p95 in WKWebView (`just perf-keystroke`) | 11 to 14 ms across 9 runs of 1000 keys | limit 16 ms only: it is whole milliseconds and a frame is 16.7 ms, so 10% is under one tick |

macOS cold start is stable (1.07) where the Linux VM's was not (3.08), so it is gated here.

**Load changes latency far more than 10%.** The same 7 metrics with 8 busy loops running (load 7 to 14): cold start x1.4, `ping` x2.1, `write_to_output` x2.2, `rail.tree` 10 Groups x8, 40 Groups x1.0 to 1.9 and widely spread; `rss_extra_mb` did not move (3.10 against a median of 3.14, committed as 3.1 because clippy rejects a literal that looks like pi). So a latency miss on a busy machine proves nothing, and a memory miss proves a lot.

**Observed false fail.** A `just perf` at load 7.5 (the baseline's loads were 0.25 to 0.45 per core, above) put `write_to_output_p95_ms` at 0.064 ms against a ceiling of 0.063 ms and failed; nothing had regressed. Each time metric with a baseline carries a `max_load_per_cpu` per OS in `budgets.json` (R13, `scenarios/perf.md`); above it, that metric's regression test is skipped, its `limit` still applies, and the run prints why. `target/perf.json` carries a `skipped` key (one entry per skipped metric, empty when none), and whenever at least one test was skipped the run's last printed line is `skipped <n> regression tests: load <x> per cpu`.

**A latency miss on macOS is rerun on a quiet machine before it is believed; a memory miss is believed at any load.**

**Real regression or noise.** Look at the load printed for each run first. A real regression moves the median above the ceiling in three reruns at the load of the baseline (up to about 0.45 per core) and does not track the load; noise falls back under the ceiling when the machine quiets, and the miss and the load rise together. A memory miss is real whatever the load. Re-baseline only with a PR that says why (copy the medians from `target/perf.json`).

## Keystroke-to-render in WKWebView

> **This opens a window over your screen and types into it.** The window is always on top and on every Space for about 40 s per run (three runs by default), and it never takes the keyboard focus on purpose, but it covers whatever you are doing. `just perf-keystroke` and `perf-keystroke` refuse unless `ROUNDUP_ALLOW_WINDOW=1` is set, and it is set only by someone the user asked to run it (R12). No agent, Reviewer, CI job, boxd VM or `just check` runs it.

What the number proves: keydown to the first xterm render that shows the echo, in the real WKWebView on macOS, with the renderer and mean frame time recorded. What it does not: it is not a CI gate and not a Linux number, it excludes the keyboard, OS event path and display scan-out, `performance.now()` is a 1 ms bound, and p95 in whole milliseconds makes a 10% test move in 1 ms steps, so its budget is the 16 ms limit only. The cheap headless bound is the Daemon-side `write_to_output_p95_ms` limit of 16 ms in `just perf` (R8).

`just perf-keystroke` (macOS only) builds the App with the keystroke probe (`VITE_ROUNDUP_PERF`, K1) into `target/perf-app`, opens its window once per run, lets the webview type 1000 keys into a raw `cat` Terminal and reads the result back (K3, R11). The report carries the renderer (`webgl` or `dom`) and the mean frame time.

What can go wrong:
- **A covered or napped window stops drawing.** macOS stops rAF and timers for a window other windows cover and naps an App that is not frontmost: measured here, with the window behind a full-screen Chrome, rendering stopped entirely and every key timed out. The perf build's window is therefore always on top and on every Space (a `TAURI_CONFIG` override in the recipe, so normal builds are unchanged), and the runner passes `-NSAppSleepDisabled YES`. The window stays over whatever you are doing for about 40 s per run, three runs. A throttled run is refused, not reported: mean frame time above 25 ms or more than 5% dropped keys exits 2.
- **Load.** Run it with the laptop idle; the load average is printed per run.
- **Windows over a headless Chromium number.** Chromium with the same xterm measured p95 under 5 ms; WKWebView on an M4 Max in the earlier spike measured 11 to 15 ms. The difference is the frame wait, so the budget is only meaningful here.


## Existing RSS gate repair (#1990)

Ten unused local event backlogs caused the RSS miss. `Terminals::start` allocated
`broadcast::channel::<EventData>(1024)` for every RPC spawn, then `Module::call`
discarded its receiver. The sender retained the preallocated buffer for the
Terminal's lifetime, although RPC subscribers receive the shared Bus instead.
[Tokio 1.53.1](https://docs.rs/tokio/1.53.1/src/tokio/sync/broadcast.rs.html),
`Sender::new_with_receiver_count`, eagerly
initializes every slot. A scratch counting allocator measured 114,824 allocated
bytes per channel (88-byte `EventData`), or 1,148,240 bytes for ten channels.

The repair passes no local sender for RPC spawns. In-process spawns still install
their channel before the reader starts; `subscribe` creates the same 1,024-slot
channel under the table lock when a later local subscriber needs one. Bus
publication, terminal counts, login shells, settling, workload, and every metric
and gate comparison are unchanged. No dependency, baseline, noise or load threshold
changes. The existing release RSS comparison is the regression observer; X8's
late-subscription test now starts over RPC, exercising the lazy channel path.
Existing Bus-output, slow-subscriber and in-process-spawn tests retain their proofs;
no redundant test was added or removed.

Before: `1406d1bb0ad1ad106a7a57114b6d6f456fa75a9c`.
After: `81246386493dda4e495eeba2cfe07bd92d585691`, based on
`e53926666c321f7886ef76b768f4ad00d62ec345`.
These immutable references identify the measured source; subsequent documentation
commits change no executable source. The intervening main change sets a Claude
plugin-watch environment variable when launching Agents; RSS is measured before
any Agent launch. The original probe and `rup` are held byte-for-byte fixed in
observation B, isolating the Daemon repair from probe changes and UI changes.

Host: Ubuntu 24.04 x86_64, AMD EPYC 7763 64-Core Processor, four available CPUs
(`0-3`), kernel `6.17.0-1022-azure`; `SHELL=/bin/bash`.
Toolchain: `rustc 1.99.0 (b940084d7 2026-09-28)`, LLVM 23.1.1;
standard workspace release profile, no build-setting overrides.
Budgets SHA-256, identical before and after:
`f85aa3a9c94316148506d2eb19c848389adc876742313fb6d19cc990e6c77236`.
The Linux RSS baseline remains 1.6 MB, noise 0.05 MB, ceiling 1.810 MB,
absolute limit 150 MB. RSS is compared at every load. Timing skips are reported
separately and do not establish a clean latency-regression observation.

Commands (all measurement defaults: eleven fresh Daemons, 1,000 calls):

```sh
# A: exact reported main revision, isolated worktree
cd /tmp/roundup-perf-before
just perf > /tmp/perf-before.log 2>&1
# actual exit: 1; retain target/perf.json as /tmp/perf-before.json
mkdir -p /tmp/perf-original-bin
cp target/release/{perf,rup,rupd} /tmp/perf-original-bin/

# Build the repair, reusing compilation artifacts, not changing build settings
cd /tmp/roundup-perf
CARGO_TARGET_DIR=/tmp/roundup-perf-before/target cargo build --release -p rupd -p rup -p perf
# actual exit: 0

# B: original observer and rup, repaired Daemon
/tmp/perf-original-bin/perf --rupd /tmp/roundup-perf-before/target/release/rupd --rup /tmp/perf-original-bin/rup --out /tmp/perf-isolated-after.json > /tmp/perf-isolated-after.log 2>&1

# C: ordinary just perf; expose the shared release directory at its expected path
ln -s /tmp/roundup-perf-before/target/release target/release
CARGO_TARGET_DIR=/tmp/roundup-perf-before/target just perf > /tmp/perf-after.log 2>&1
# retain target/perf.json as /tmp/perf-after.json
sha256sum /tmp/perf-original-bin/{perf,rupd,rup} target/release/{perf,rupd,rup}
```

Binary SHA-256:

| Binary | Before (A; B uses the same probe and rup) | After (C; B uses this rupd) |
|---|---|---|
| perf | `739bfa4173890cd40056b7e61d54def4ff3a7c7b66cc8b6bcb73e63936d6ddc8` | `cd300c174546f64f80e57bc9824b08b90ffa2773046709f129360b6ab46c14eb` |
| rupd | `44cd40c77851978ca01a640d6674df8225430f432b35ddfdb0bc19020553a9cb` | `7a1b01e89399a317af07e84ebf18f55fa78da47737c2c7692b820d021ec9825e` |
| rup | `1c820f7fda98a8dff56b9e7e676ec6eae8e8154b8ecc405076d8848f0ebc46ec` | `1c820f7fda98a8dff56b9e7e676ec6eae8e8154b8ecc405076d8848f0ebc46ec` |

Every observation follows, including all per-run metrics and loads. Concurrent
repository builds/tests supplied the load; no synthetic load was introduced.

### A: unchanged reported main

Actual exit: 1.

```json
{
  "os": "linux",
  "cpus": 4,
  "runs": 11,
  "loads": [4.15,4.15,3.81,3.59,3.7,3.7,3.73,4.95,5.1,5.1,5.18],
  "metrics": {"cold_plugin_materialization_ms":18.927943,"cold_start_ms":20.488578,"hook_loop_ms":598.9693219999999,"ping_p95_ms":0.141354,"rail_tree_10_p95_ms":0.318556,"rail_tree_40_p95_ms":1.4818209999999998,"rss_extra_mb":2.03515625,"terminal_write_p95_ms":0.24598000000000003,"write_to_output_p95_ms":1.151909},
  "per_run": {"cold_plugin_materialization_ms":[12.374559,11.704776,11.457343,13.048087,36.972328999999995,37.118159999999996,18.116638000000002,36.564001,19.993921,36.022325,18.927943],"cold_start_ms":[13.339322000000001,11.300289999999999,11.425348999999999,15.210048,20.488578,27.590274,30.977218,34.844477999999995,27.983764,28.746508000000002,15.693354999999999],"hook_loop_ms":[276.770142,277.42731,308.204498,712.822709,598.9693219999999,749.149906,956.683477,897.992965,801.014188,433.134708,317.180362],"ping_p95_ms":[0.12287,0.105357,0.14126699999999998,0.137136,0.145893,0.14952,0.143849,0.13303800000000002,0.141354,0.159849,0.144547],"rail_tree_10_p95_ms":[0.29929,0.233026,0.256043,0.26742699999999997,0.328224,0.333894,0.326521,2.642091,0.306823,0.318556,0.37220899999999996],"rail_tree_40_p95_ms":[0.6503359999999999,0.5063300000000001,0.630653,1.4818209999999998,1.443194,2.1812989999999997,2.9955619999999996,3.0247669999999998,2.273182,3.268792,0.776152],"rss_extra_mb":[2.58203125,2.53125,2.59375,2.58984375,1.96484375,1.9765625,1.96875,1.96484375,2.03515625,1.89453125,2.5390625],"terminal_write_p95_ms":[0.132396,0.131078,0.146143,0.260627,0.252343,0.216264,0.35611600000000004,0.573412,0.24598000000000003,1.141855,0.156612],"write_to_output_p95_ms":[0.24466400000000002,0.24726199999999998,0.257853,1.883642,1.151909,2.116678,2.530703,2.222806,2.279202,0.274684,0.35622699999999996]},
  "skipped": []
}
```

### B: original probe and rup, repaired Daemon

Actual exit: 0.

```json
{
  "os": "linux",
  "cpus": 4,
  "runs": 11,
  "loads": [9.89,9.26,8.84,10.05,11.09,11.72,12.55,11.62,12.06,11.79,11.57],
  "metrics": {"cold_plugin_materialization_ms":36.068286,"cold_start_ms":32.143625,"hook_loop_ms":728.5732230000001,"ping_p95_ms":0.14205199999999998,"rail_tree_10_p95_ms":0.341719,"rail_tree_40_p95_ms":1.899704,"rss_extra_mb":0.89453125,"terminal_write_p95_ms":0.23515,"write_to_output_p95_ms":2.247013},
  "per_run": {"cold_plugin_materialization_ms":[19.104284,36.955481999999996,36.283816,36.068286,37.969332,32.264518,17.164327,16.898139,59.27011,19.48638,36.395581],"cold_start_ms":[20.114382,33.083721000000004,27.055746,32.143625,43.638547,26.705363,13.602825000000001,27.665395,35.625611,36.819905999999996,42.893412],"hook_loop_ms":[674.991483,630.910642,825.684769,818.291294,671.609177,302.083559,424.152176,1155.813337,1109.479811,798.63266,728.5732230000001],"ping_p95_ms":[0.138479,0.13623500000000002,0.141445,0.145381,0.144881,0.134391,0.14205199999999998,2.54489,0.296585,0.350134,0.140843],"rail_tree_10_p95_ms":[0.33409500000000003,0.337091,0.325068,2.5964270000000003,0.341719,0.324507,0.328054,4.1746989999999995,4.547796,3.695761,2.510815],"rail_tree_40_p95_ms":[2.933657,0.783045,1.899704,2.247995,0.843158,0.761284,0.7987839999999999,6.724689,5.77384,3.556581,1.5829710000000001],"rss_extra_mb":[0.90625,0.890625,0.90625,0.828125,0.88671875,0.90234375,0.83984375,0.890625,0.89453125,0.90234375,0.91015625],"terminal_write_p95_ms":[0.196868,0.534259,0.23515,0.199373,0.27637700000000004,0.155521,0.200585,1.3476009999999998,0.921975,1.235711,0.233376],"write_to_output_p95_ms":[0.266409,1.579474,2.345888,2.249428,2.247013,0.735575,0.26055700000000004,4.791784000000001,2.851153,3.004228,0.27690800000000004]},
  "skipped": [{"metric":"cold_plugin_materialization_ms","load_per_cpu":2.8925,"max_load_per_cpu":2.0},{"metric":"ping_p95_ms","load_per_cpu":2.8925,"max_load_per_cpu":2.0},{"metric":"rail_tree_40_p95_ms","load_per_cpu":2.8925,"max_load_per_cpu":2.0},{"metric":"terminal_write_p95_ms","load_per_cpu":2.8925,"max_load_per_cpu":2.0},{"metric":"write_to_output_p95_ms","load_per_cpu":2.8925,"max_load_per_cpu":2.0}]
}
```

### C: just perf on the repair

Actual exit: 0.

```json
{
  "os": "linux",
  "cpus": 4,
  "runs": 11,
  "loads": [10.35,10.16,9.83,9.68,9.46,9.27,9.08,9.08,8.99,8.67,8.62],
  "metrics": {"cold_plugin_materialization_ms":23.378141000000003,"cold_start_ms":27.488512,"hook_loop_ms":850.4161789999999,"ping_p95_ms":0.146794,"rail_tree_10_p95_ms":0.328454,"rail_tree_40_p95_ms":2.732348,"rss_extra_mb":0.88671875,"terminal_write_p95_ms":0.23918799999999998,"write_to_output_p95_ms":2.0851889999999997},
  "per_run": {"cold_plugin_materialization_ms":[18.985671,26.32712,39.864111,40.268286,37.080431,19.407021,31.565893,17.733964,17.927476000000002,18.338865,23.378141000000003],"cold_start_ms":[34.353615,27.488512,24.064460999999998,32.454339999999995,33.069871,24.146722999999998,33.086486,24.840119,21.175007,29.147625,24.462108],"hook_loop_ms":[640.626154,853.408005,862.2046359999999,850.4161789999999,905.013584,651.818652,995.189035,753.16233,867.339569,823.9899849999999,627.2163859999999],"ping_p95_ms":[1.858414,0.151243,0.146124,0.146013,0.151753,0.146794,0.14013099999999998,0.145563,0.175668,0.150551,0.136034],"rail_tree_10_p95_ms":[0.346649,0.320028,0.325669,0.328454,1.489957,2.796068,0.325739,0.324166,0.301174,1.669792,0.337672],"rail_tree_40_p95_ms":[3.063596,0.923697,2.732348,2.219249,2.530602,3.292966,2.865697,1.893049,3.036178,1.121808,3.2747829999999998],"rss_extra_mb":[0.90625,0.828125,0.88671875,0.890625,0.88671875,0.88671875,0.91015625,0.83203125,0.890625,0.90234375,0.8828125],"terminal_write_p95_ms":[0.25651999999999997,0.293038,0.224069,0.222125,0.231443,0.222456,0.249576,0.235931,0.269584,0.7149669999999999,0.23918799999999998],"write_to_output_p95_ms":[2.0851889999999997,2.048031,1.537734,2.092734,2.596205,2.351988,2.223297,2.5366630000000003,1.659684,0.332401,1.1589669999999999]},
  "skipped": [{"metric":"cold_plugin_materialization_ms","load_per_cpu":2.3175,"max_load_per_cpu":2.0},{"metric":"ping_p95_ms","load_per_cpu":2.3175,"max_load_per_cpu":2.0},{"metric":"rail_tree_40_p95_ms","load_per_cpu":2.3175,"max_load_per_cpu":2.0},{"metric":"terminal_write_p95_ms","load_per_cpu":2.3175,"max_load_per_cpu":2.0},{"metric":"write_to_output_p95_ms","load_per_cpu":2.3175,"max_load_per_cpu":2.0}]
}
```
