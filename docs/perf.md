# Perf

Rule 7's budgets and what measures each. Linux VM numbers are Linux numbers. The macOS baseline was recorded on a laptop in ordinary use (load 4 to 7 on 16 cores, 0.25 to 0.45 per core), not an idle one, so it is a baseline for that machine under that load.

| Budget | Measured by | Where |
|---|---|---|
| Daemon cold start < 300 ms | `just perf` (`cold_start_ms`: spawn `rupd` to its first `daemon.ping` reply) | any machine; the App's cold start to a visible window is manual |
| Cold plugin materialization < 300 ms | `just perf` (`cold_plugin_materialization_ms`: pinned Q11 plugins into fresh empty storage) | any machine; 10% regression against its recorded Linux baseline |
| 10 idle Agents < 150 MB extra RSS | `just perf` (`rss_extra_mb`: the Daemon's growth with ten login-shell Terminals) | any machine; the Agents' own processes are manual |
| Keystroke-to-render < 16 ms p95 | `just perf-keystroke`, only when the user asks ([native keystroke runbook](perf-keystroke.md)) | the macOS App only |
| Switcher open < 80 ms and switch < 32 ms p95 | `just perf-keystroke` idle run (SP4): after the typing, on the `tree-40` Project with a second shell Terminal, 110 opens and 110 switches, the first 10 of each discarded | the macOS App only |
| Regression above 10% fails | `just perf`: stored class baseline, or R16 same-job merge-base/head pair on an uncalibrated supported Builder | same class; paired builds share one host/job |
| 100-tool-use loop's hook-process cost stays within a fixed limit | `just perf` (`hook_loop_ms`: 200 `rup signal` calls against a fresh Daemon, H15) | any machine; limit-only on the stored path, paired regression on uncalibrated Builders |

**H15's hook cost.** `rup signal` cost 3.8 ms wall and 4.3 ms CPU per call on architect-swarm's Mac before H15 (read by hand, not committed), about 760 ms wall for the 200 calls (`PreToolUse` and `PostToolUse`) a 100-tool-use loop makes. The replay rule in `crates/agents/tests/state_events.rs`, which also replays each fixture's titles and compares the whole Status, finds no event in `STATE_EVENTS` prunable: `PreToolUse`'s Signal is what lets A2's star hold (`crates/agents/src/claude_code/mod.rs`) tell a star that may precede a dialog from one that may not. `STATE_EVENTS` keeps all nine events and a tool use still costs two `rup signal` calls. The one saving is a current-thread runtime in `crates/rup/src/main.rs`, so `rup signal` runs one OS thread (`h15_rup_signal_never_runs_more_than_one_os_thread`, `crates/rup/tests/signal.rs`). `hook_loop_ms` is the wall time of 200 sequential `rup signal` calls against a fresh Daemon; on the stored path it is limit-only, with no baseline and no R13 skip. R16's uncalibrated-Builder pair additionally compares its head value with base under the paired load rule. Its `limit` of 2000 ms is a gross tripwire, not a saving: the figure was read by hand and is not committed. The end-to-end check, with the real settings `agent.spawn` writes, is `h15_every_hook_call_of_a_hundred_tool_use_loop_is_answered_and_the_final_stop_leaves_the_agent_idle` (`crates/rup/tests/e2e.rs`).

`just perf` runs a fresh Daemon 11 times, takes each metric's median, prints the range and each run's load average, writes `target/perf.json` and exits 1 on a miss. Run it on a quiet machine; retain busy runs with their load and skip reasons, then repeat them without counting them as clean evidence. A metric fails above its `limit`, or above its selected comparison value by more than 10% plus its existing `noise` allowance. R16 below specifies the same-job fallback; this specification PR adds acceptance, not an implemented perf pass.

CI build measurements are separate from runtime budgets. Cache lookup, saved-entry download/unpack, compilation, linking and full job duration need separate intervals; a cold-cache rebuild is not cache restore time. A secondary startup timer must measure the same spawn-to-first-successful-ping interval as `just perf`, against the same reference/head binaries on one host. Changing the timer supplies no runtime improvement and changes none of the budgets above.

**Q11's cold plugin materialization.** Each release `perf` run materializes the pinned plugin bundle into a new empty temporary directory. Only `plugins::materialize` is timed; `bundle.validate()` must then succeed or the observer exits 2. The median is printed as `cold_plugin_materialization_ms` and retained in `target/perf.json`. Its rule 7 limit remains 300 ms on every OS at every load. Regression above the recorded Linux baseline by more than 10% plus the clock-resolution allowance fails (exit 1), using the same R13 load rule as other latencies. `just check` verifies empty-directory materialization and validation without a wall-clock assertion (`q11_cold_materialization_produces_a_valid_bundle`).

Q11's Linux baseline is 11.940635 ms, the median of nine eleven-sample release observations on 2026-10-14 (Ubuntu 24.04, four available CPUs, AMD EPYC 7763 64-Core Processor, rustc 1.99.0). The nine medians were 11.889899, 11.971422, 12.378832, 11.931701, 11.680185, 11.874712, 11.944743, 11.940635 and 12.034941 ms (max/median 1.037, min/median 0.978); median load per CPU was 0.60–1.20. The probe is commit `9ff3cf3e` in [#1762](https://github.com/saadshahd/roundup/pull/1762); this baseline applies to that Linux machine class, not macOS. The clock-resolution allowance is 0.001 ms, and R13's Linux threshold is 2.0 load per CPU. The 300 ms hard limit applies even when load skips the regression comparison; macOS has the hard limit until its own baseline is measured. Tests `r8_the_committed_limits_are_rule_sevens_budgets` and `r9_a_value_at_a_committed_limit_passes_and_the_next_one_fails`, `q11_cold_plugin_materialization_rejects_a_release_regression_below_the_hard_limit` and `q11_perf_reports_cold_plugin_materialization_and_fails_an_over_budget_median` exercise the gates with synthetic samples, never clock assertions.

## Perf work and evidence (R25–R27)

RPC perf dispositions live beside each method in `crates/contracts/src/declarations.rs` and reach consumers through `contracts::methods::metadata()`. The single `c5459b_missing_metadata_names_the_field` observer checks completeness. `crates/perf/budgets.json` holds measured budgets only. Metadata adds no metric and waives no R7 measurement. Off-path is a workload disposition, never a claim that a method is fast. Review a changed method's disposition against its behavior.

Every perf repair PR carries a table with metric/unit, before/after values, reference commits, exact observer command, host class, physical host identity and run/session identity. Compare the same observer command on one host in one session, changing only reference binaries or repaired code. Retain reports, failures, skips and exit codes. Isolate probe changes by running old/new probes against the same binaries before attributing a difference. Another host or command supplies diagnosis, never the required pair.

The existing `budget` test target validates every added, changed or removed baseline against the actual Git base/head, independently of R8's pins. CI's `BASE` selects the main-side parent of its tested merge; a local branch uses `git merge-base origin/main HEAD`. On main, compare its first parent. Unreadable Git versions fail. Unchanged baselines need no new evidence.

Commit `crates/perf/baseline-pairs.json` beside `budgets.json` for baseline edits. It is an array with one matching entry per changed metric/class and old/new value. Additions/removals explicitly use `null`; omitted fields fail. For example (schema only, **not measurement evidence**):

```json
[{
  "metric": "ping_p95_ms", "class": "linux-9v45", "old": null, "new": 0.025,
  "before": {"metric": "ping_p95_ms", "class": "linux-9v45", "measurement": 0.024, "unit": "ms", "reference": "<full before commit id>", "command": "just perf --runs 11", "host": "<physical VM identity>", "session": "<one observation session>", "report": "crates/perf/evidence/before.json"},
  "after": {"metric": "ping_p95_ms", "class": "linux-9v45", "measurement": 0.025, "unit": "ms", "reference": "<full after commit id>", "command": "just perf --runs 11", "host": "<same VM identity>", "session": "<same observation session>", "report": "crates/perf/evidence/after.json"}
}]
```

Each report path must exist in the tested Git head and repeat its observation's fields exactly. Use `ms` or `MB`, full 40-character reference commits and distinct report paths. Reports can retain additional raw samples, exit codes, hashes and artifact paths; preserve the original observer output alongside those report facts. Measurements need not equal baselines: R16 calibration uses nine clean invocation medians. This pair is necessary evidence, never permission to raise a baseline. R16's diagnosis, calibration, provenance and independent observations, R8's pins and R13's load qualification still apply. The PR body table remains required policy even with committed evidence. This change supplies no baseline or performance pass.

### Execution hosts

| Issue | Host class | What runs where |
|---|---|---|
| [#3696](https://github.com/roundup-app/roundup/issues/3696) | `macos` | Write latency and full perf acceptance on the same qualified Mac; code work consumes its retained evidence. |
| [#3550](https://github.com/roundup-app/roundup/issues/3550) | `macos` | `just perf-keystroke` in the real release App webview on the required Mac. |
| [#3013](https://github.com/roundup-app/roundup/issues/3013) | `macos` | Native motion observation in the App on the required Mac. |
| [#3720](https://github.com/roundup-app/roundup/issues/3720) | `linux-9v45` | Same-host historical/current regression diagnosis and measured repair. |
| [#3760](https://github.com/roundup-app/roundup/issues/3760) | `linux-9v45` | Paired write-path timing and profiles on one qualified 9V45 host. |
| [#3971](https://github.com/roundup-app/roundup/issues/3971) | `linux-9v45` | Isolate write-stage scheduling and historical output-adapter cost for #3760. |
| [#3764](https://github.com/roundup-app/roundup/issues/3764) | `linux-9v45` | Qualify the execution lifetime and run dependent probes within that lifetime. |
| [#3706](https://github.com/roundup-app/roundup/issues/3706) | `linux-9v45` | R16 diagnosis, calibration and independent observer evidence on 9V45. |
| [#3848](https://github.com/roundup-app/roundup/issues/3848) | `any` | Live-method and committed-evidence Rust checks; no machine-specific measurement. |

`any` means the result does not require a particular host; it never substitutes for unavailable hardware. Same-class and same-Mac requirements remain. Before code work whose acceptance needs an unavailable host, its Builder creates or reuses a scoped measurement Issue naming host, exact commands, reference commits and retained evidence, then a code Issue natively blocked by it. The measurement Issue owns observations; the code Issue consumes them. Reuse existing measurement prerequisites. Host qualification alone completes no observation, and a probe requiring a qualified host lifetime runs within it. The seven Issues above and their acceptance are unchanged here; their Builders own those splits, preserving dependencies and ownership. Unavailable hardware is an execution prerequisite. Only an observation the user's Mac alone can produce uses the Mac-request rule.

## Off the hot path

Each declaration names its measured metrics or its exact off-path reason.
Read these through `contracts::methods::metadata()`; adding a method edits no perf registry.


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

`noise` is an absolute floor for the clock's resolution, not slack: it is 0.05 MB on a 1.6 MB metric and 1 microsecond on latencies of 25 to 265 microseconds. The worst observed ratio (1.13, `ping`) is a 0.5 microsecond overshoot that the floor covers; with only 9 invocations, one false fail in a few dozen runs is expected, so rerun before believing a single fail. The `linux-boxd` baselines are the medians of those 9 invocations and are valid for that VM class only. The `macos` baselines are in the next section; the `limit`s hold anywhere. Accept a baseline only after the R16 diagnosis, calibration and independent observations below, with R26 committed paired evidence and the repair table above. Keep OS/class keys and provenance separate; copying one run's medians and explaining them does not establish a baseline.

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

The identity evidence in #1266 records a 9V45 Builder at `7922b6f225452fc4da68396d7d75b4ed0054fa74`; it establishes the supported identity, not performance. A 7763 report cannot establish a 9V45 baseline even with identical Ubuntu and CPU counts. An unknown identity or any missing required identity field is an observer error (exit 2), naming the mismatch or missing input. Under the amended R16 acceptance, a supported Builder without complete measured baseline/provenance uses the same-job pair below. An identity error cannot reuse another class's values or report a clean pass. R16 assigns selection/report metadata to `r16_builder_selects_its_measured_class` and these rejections to `r16_unknown_or_incomplete_linux_class_is_an_observer_error`; these are implementation obligations for all five Builder identities.

The identity evidence in #1303 records an Intel 8573C Builder at `ab349a1d5f46d0dce3c6d51a0a0f8617311c4669` on 2026-10-12: Ubuntu 24.04, x86_64, online CPUs and affinity `0-3`, four available CPUs, kernel `6.17.0-1022-azure`, rustc `1.99.0 (b940084d7 2026-09-28)` and cargo `1.99.0 (5f94df478 2026-08-27)`. This records identity only; AMD measurements establish no Intel baseline.

The identity evidence in #1313 records a 9V74 Builder at `2ae44989f5ec68a2c9021a381f5f2eae8cbb63ff` on 2026-10-12: Ubuntu 24.04 (`ID=ubuntu`, `VERSION_ID=24.04`), x86_64, exact CPU model `AMD EPYC 9V74 80-Core Processor`, online CPUs and affinity `0-3`, four available CPUs, kernel `6.17.0-1022-azure`, rustc `1.99.0 (b940084d7 2026-09-28)`, cargo `1.99.0 (5f94df478 2026-08-27)` and shell `/bin/bash`. This records identity only. No other CPU class can establish its baseline or provenance.

The identity evidence in #1941 records an Intel 8370C Builder at `06fd4eb7e24c476b104e52b94e78fa491d2f47f4`: Ubuntu 24.04.5 (`ID=ubuntu`, `VERSION_ID=24.04`), architecture `x86_64`, exact CPU model `Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz`, online CPUs `0-3`, four available CPUs and process affinity `0-3`. Diagnostic metadata: kernel `6.17.0-1022-azure`, rustc `1.99.0 (b940084d7 2026-09-28)`, cargo `1.99.0 (5f94df478 2026-08-27)` and shell `/bin/bash`. This is identity evidence only; its standalone preflight exit 2 is a qualification failure, not a `just perf` result or latency observation. No Daemon/probe build, timing or benchmark failure is claimed. No other CPU class establishes its baseline or provenance, including Intel 8573C.

#1266, #1303, #1313 and #1941 specify identities only; the Intel specification PR closes #1303 when its specification acceptance holds and the 9V74 specification PR uses `Refs #1313` and closes #1313 only when its specification acceptance holds; the 8370C specification PR uses `Refs #1941` and `Closes #1941` only when its specification acceptance holds. #1366 stays open for same-host Message latency evidence, #1361 for final combined latency acceptance and #1251 for observer implementation, independent calibration and completion observations. Measurement policy: for each newly measured class, including 9V74 and 8370C independently, R16 requires historical/current same-host diagnosis with nine alternating invocations of eleven fresh Daemons per reference, compatible identical probe bytes and isolation of probe changes using the same binaries, nine clean calibration invocations only after regression diagnosis and repair, then three separate clean eleven-Daemon observations on the implementation head with the baseline fixed. Retain every report, per-run metric and load, failed observation and repeat, exit code, reference commit, binary hash and exact command; retain and repeat busy invocations rather than counting them as clean. Diagnose and repair Daemon or probe regressions before accepting a baseline. This identity amendment supplies no evidence that either regression is absent.

### Class selection

`just perf` reads `/etc/os-release`, `lscpu`, `/sys/devices/system/cpu/online`, `/proc/self/status` and available CPUs (`crates/perf/src/machine.rs`). Exact R16 identity matching remains: narrowing a Builder's affinity cannot select boxd. Unknown identities and missing machine facts exit 2. Complete stored R16 calibration means all five Linux baseline metrics and non-empty class provenance in `crates/perf/classes.json`; those classes retain the existing stored-baseline path. Boxd and macOS behavior remains unchanged.

### Same-job fallback (R16 acceptance; implementation follows #4134)

Current code still rejects supported Builders without complete calibration. The amended acceptance makes this selection automatic:

```text
supported Builder
  complete stored R16 baseline → existing stored-class judgment
  absent or partial baseline   → same-job merge-base/head comparison
unknown or incomplete identity → exit 2
```

Resolve head to full `HEAD` and base to `git merge-base origin/main HEAD`. Build both revisions' release Daemon, CLI and required sidecar into separate owned locations with identical toolchain/settings; finish builds before measurement. Use the same head observer bytes, arguments and workload against both binaries on the same job/host. Default is one base invocation followed by one head invocation, eleven fresh Daemons each; additional pairs alternate base/head with equal counts. Compare invocation medians (median of invocation medians if repeated). No calibration, historical attribution, streak or multiple-host campaign is required. Commit source changes before claiming a gate.

For each budgeted head metric, fail above `base * 1.10 + existing noise`, including cold start, Rail-10, plugin materialization and hook-loop cost. Every head absolute limit still applies. Applicable stored-class comparisons, including Q11 on a partially calibrated 7763, also remain enforced. Exactly at a ceiling/limit passes; the next representable value fails. A base numeric miss stays visible and does not prevent head comparison. Neither path writes or raises stored baselines, limits, noise or load thresholds.

R13 latency qualification checks both sides against Linux's unchanged 2.0 load-per-CPU threshold. A busy side produces the metric/side/load/threshold skip in JSON, printed output and the summary; exit 0 with skips never proves no regression. RSS compares at every load; absolute limits always apply. Missing/invalid references, failed builds, incompatible common observer, missing reports/metrics/loads, unequal or zero invocation counts, mismatched host/boot identity and invalid numeric samples exit 2 naming the input or stage. A missing stored baseline on a supported Builder alone no longer exits 2. Valid numeric misses exit 1.

Retain comparison mode, both full source SHAs, host/job/boot identity, class/machine facts, observer/binary hashes, toolchain/settings, commands and invocation order, raw samples, medians, loads, skips, exits, startup logs and each metric's base/head/ceiling/limit verdict in `target/perf.json` and printed results. Retain failed observations too; clean up only owned checkouts/processes. An unavailable reference or observer incompatibility is an engineering repair, never a substituted baseline or passing gate.

Implementation proof is `cargo nextest run -p perf` using deterministic fixtures through production selection, orchestration, judgment and report seams: R16 names the paired edge, absolute-limit, load, invalid-input, metadata, partial-calibration and calibrated-path observers. Fixtures use temporary Git repositories and injected measurements/build results; no real timing assertion or expensive child build is needed. The calibrated fixture gives opposite stored/pair verdicts and proves no base build occurs. R10 defines exits; R22 continues to govern optional committed calibration evidence, independently of the paired gate.

The paired collector is `crates/perf/src/paired.rs`; its process adapter uses
Git's detached worktrees, Cargo's locked release builds and the existing sidecar
bundler. `--pairs N` requests N alternating invocations of each revision; `--runs`
and `--calls` apply equally to both. The default remains one pair of eleven fresh
Daemons per side. The gate retains command logs, observer metadata, individual
invocation reports and startup logs beside the selected output. Temporary source
worktrees and their build products are removed after collection; reports remain.

Stored calibration still follows R16's historical diagnosis, nine clean calibration invocations and three independent observations. R8 pins and R13 remain unchanged. This work supplies no new stored baseline, calibration or measured perf pass and changes no loop machinery. Tests can complete #4134's implementation acceptance without a calibration campaign.

### R23 execution lifetime (#3764)

[Host attempts, qualified observations and reproduction instructions](perf-r23-execution.md).

[Producer-observer attempt 40193504693](../crates/perf/evidence/r23-host-40193504693/README.md)
failed the unchanged exact-9V45 preflight (exit 2): `Intel(R) Xeon(R) 6973P-C`.
Runner inventory was inaccessible (HTTP 403, exit 1); the existing Builder inputs
provide no exact-model selector. No qualified target was identified and no
collection ran. #4032 remains the execution prerequisite of #4031 under #3760
and #3720; producer/initial-dispatch capture, isolated repeated controls and their
assessment remain incomplete. This host record completes none of those Issues.

[Producer-observer attempt 40196101407](../crates/perf/evidence/r23-host-40196101407/README.md)
also failed the unchanged preflight (exit 2): `AMD EPYC 7763 64-Core Processor`.
Runner inventory returned HTTP 403 (exit 1); job metadata and existing launch
inputs identify no reachable qualified target. The matching boot IDs, commands,
outputs, statuses and machine/load/process records are retained. No collection
ran: #4032, #4031 and #3760 remain incomplete under #3720. This supplies no new
producer/dispatch observation, repeated control, overhead bound or timing verdict.

### R23 hosted producer/dispatch collection (#4032)

[R23 producer/dispatch capture and offline assessment](../crates/perf/evidence/r23-producer-40214115988/README.md)
records Builder 40214115988's actual CPU (`AMD EPYC 9V45 96-Core Processor`)
without requiring that model. Both pinned references and all 24 alternating
controls share this job and matching boot identity. Both captures join 2200
writes/echoes to physical PTY endpoints; supported source probes reach producer
locations, dispatch prologue precedes field extraction, and Tokio hooks separately
bracket complete spawned-task polls. Commands, failures, source patches, executable
bytes, hashes, load/process records and replay scripts are retained together.

All controls are load-qualified with no skips, but instrumentation shifts write
p95s materially and source/perf costs remain inseparable. The report states each
metric's variation and each unresolved enqueue/producer/task bound; it claims no
Daemon-only cause or clean timing verdict. The six earlier clean pairs remain
history, never this host's comparison base. This execution-only collection adds
no timing campaign, calibrated baseline or production repair. #4031 and #3760
remain open under #3720. R16/R23 now explicitly retire exact-CPU eligibility for
this hosted collection; ordinary calibrated baseline selection stays separate.

### R23 incremental recorder controls (#4109)

[Recorder overhead capture and offline assessment](../crates/perf/evidence/r23-overhead-40221022276/README.md)
restore #4082's matching archived instrumented Daemons and common/marked
observers on job 40221022276 (AMD EPYC 9V45, four CPUs, one boot). Three cycles
per pin/probe alternate recorder-off, scheduler/syscall recording and the same
recorder plus retained producer source probes. Hook/logger bytes and diagnostic
build settings remain identical. These single-Daemon controls preserve the R15
workload; they are neither eleven-Daemon clean comparisons nor calibration.

All 36 controls are load-qualified (load 1.68–3.39 on four CPUs), with no skipped
write metrics. Every attempt retains its diagnostic ceiling miss; historical/marked
cycle 2 with the recorder off also misses the 300 ms absolute cold-start limit
(610.779718 ms). All full recordings have producer hits; none reports LOST events.
The retained assessment reports each metric's variation and every paired
incremental difference/ratio separately for historical/common, historical/marked,
candidate/common and candidate/marked. Three repetitions supply observed
variation, not a universal overhead bound. Aggregate p95 deltas cannot bound or
correct individual stage intervals in #4031's earlier profiles. Nothing is
subtracted from clean p95s. Configuration/logger confounding, optimized
publication boundaries and unsupported exact executor enqueue remain unresolved;
supported task-spawn hooks are not enqueue timestamps. Daemon-only attribution
under #4031, #3760 and #3720 remains incomplete. The evidence names the remaining
observations and scoped engineering investigation; no user or Mac decision is
needed. Original clean observations remain labelled history only. No baseline,
ceiling, load threshold, absolute limit or clean R16 verdict changes.

### R23 observer acceptance assessment (#4031)

[Offline verification and supported boundaries](../crates/perf/evidence/r23-observer-40219905108/README.md)
replays #4082's producer capture and controls from the raw retained logs, preserving
request/task/thread/FD identities. It separates pre-extraction dispatch,
submission/first selected poll, actual pinned producer locations and complete
spawned-task poll hooks from unsupported exact executor enqueue and optimized
publication timestamps. Thread CPU remains distinct from useful-task CPU.

The 24 controls show substantial instrumentation variation, including one retained
historical/common echo outlier. [#4110's recorder controls](../crates/perf/evidence/r23-overhead-40221022276/README.md)
now complete #4109: 36 fixed-binary attempts separately measure additional
recorder variation. Aggregate p95 differences cannot correct individual stages;
diagnostic configuration, logger and hooks remain confounded.

[The cumulative assessment and native profiler attempts from run 40227127433](https://github.com/roundup-app/roundup/actions/runs/40227127433)
replay both assessments exactly and verify all ten executable members. Raw files
are retained outside git in artifact `r23-capability-40227127433`,
[uploaded by fix run 40229755357](https://github.com/roundup-app/roundup/actions/runs/40229755357/artifacts/12612748101).
The archive SHA-256 is `1a5cec1a9b0cc57f1c5638ab40122499fec4df484bcf01175639ca7398df93b8`.
Native `schedule_local` probes resolve at both pins; candidate byte-broadcast `send`
entry/return definitions also resolve, but the broad entry pattern yields two
addresses and perf exposes no named arguments. These definitions supply no hits,
exact queue insertion or task identity. The pinned Tokio 1.53.1 contract exposes
no task-identity enqueue hook; aggregate schedule-latency histograms do not supply
one. [#4120](https://github.com/roundup-app/roundup/issues/4120) blocks #4031 with
validated native argument/identity recovery, local/remote scheduling and byte-send
samples plus controls for that probe set, using existing profiler capabilities.
Attribution remains incomplete; #4031 and #3760 stay open under #3720. No new
clean timing campaign, p95 correction, baseline, calibration, production repair
or user/Mac decision is supplied. Each original clean write-metric comparison
remains separately labelled history below.

### R23 paired write conclusions (#3760)

[Paired measurements, reference commits, ceilings, compatibility failures and profile qualifications](perf-r23-writes.md#r23-paired-write-conclusions-3760).

### R23 retained thread attribution (#3971)

[Retained thread attribution, unresolved boundaries and scoped capture requirements](perf-r23-writes.md#r23-retained-thread-attribution-3971).

### Builder 9V45 diagnosis (#3700, R16 steps 1 to 3)

No Builder baseline is recorded: the same-class comparison finds a regression, not a class mismatch, and R16 step 3 says to repair it before accepting baselines. The earlier 7763 figures (taken from `main` itself, with no historical comparison) are withdrawn; a 7763 baseline needs its own diagnosis on a 7763 host.

References: the commit that set the Linux baselines, `2029ed2c4ee606d26e73c858c4d7c93130df36e0` (2026-10-01), and `main` at `90df821c0` (2026-10-24), 21,720 added lines of Daemon and probe source apart. Both built with `cargo build --release -p rupd -p rup -p perf`, rustc 1.99.0; hashes and machine facts are in `crates/perf/evidence/linux-9v45/machine.txt`. Commands, nine rounds alternating the two on one VM (AMD EPYC 9V45, four CPUs), 11 fresh Daemons each, script `crates/perf/evidence/linux-9v45/diagnosis/reproduce.txt`: historical `perf --runs 11 --rupd <hist>/rupd --out historical-N.json`, current `perf --runs 11 --budgets <scratch>/budgets.json --out current-N.json`, where the scratch `budgets.json` and `classes.json` copy `linux-boxd` into `linux-9v45` so the current binary runs. Every report, log and exit code is kept (`historical-N.*`: exit 0; `current-N.*`: exit 1, the ceilings missed). Loads were 1.6 to 3.8 on four CPUs, under R13's 2.0 per CPU, so every invocation is clean.

| Metric | Historical median | Ceiling (×1.10 + noise) | Current median | Current invocations over ceiling |
|---|---|---|---|---|
| `ping_p95_ms` | 0.0358 | 0.0404 | 0.0700 | 9 of 9 |
| `rail_tree_40_p95_ms` | 0.1917 | 0.2119 | 0.3575 | 9 of 9 |
| `rss_extra_mb` | 2.5195 | 2.8215 | 3.0742 | 9 of 9 |
| `terminal_write_p95_ms` | 0.0624 | 0.0697 | 0.1077 | 9 of 9 |
| `write_to_output_p95_ms` | 0.1108 | 0.1229 | 0.1629 | 9 of 9 |

Conclusion per metric: the historical reference misses the boxd ceilings by a factor near 1.4 (`ping_p95_ms` 0.0358 against 0.025), which is class; current `main` is a further 1.5 to 2 times slower than the historical reference on the same VM, which is a regression that class does not excuse. `ping_p95_ms`, `terminal_write_p95_ms` and `write_to_output_p95_ms` keep step 3 in full; `rail_tree_40_p95_ms` is covered by the user's 0.71 ms settlement (its 0.3575 is under it); `rss_extra_mb` rose 0.55 MB and stays far under 150 MB.

Probe isolation failed and is recorded rather than hidden: the historical probe against today's `rupd` and today's probe against the historical `rupd` both exit 2 (`rail.createGroup` and `rail.createWorkstream` not found; `newprobe-histdaemon-N` and `oldprobe-curdaemon-N`). A first-parent `git bisect` between the two also skipped most steps, because intermediate commits do not build or write a report. #3720 owns the repair and the isolation; #3700 stays blocked on it. The sidecar is not the cause (rule 7 cold start about 30 ms, ten idle Agents about 3 MB extra). The macOS write-path figures belong to #3696, whose owner direction records the 16 ms delay as fixed.

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

**Real regression or noise.** Look at the load printed for each run first. A real regression moves the median above the ceiling in three reruns at the load of the baseline (up to about 0.45 per core) and does not track the load; noise falls back under the ceiling when the machine quiets, and the miss and the load rise together. A memory miss is real whatever the load. A new baseline requires R16 diagnosis/calibration and R26 same-host paired evidence, never copying a single report's medians.

## macOS `cold_start_ms` and `rail_tree_40_p95_ms` (#3696)

The #3696 startup and Rail attribution record lives in [`perf-macos-startup.md`](perf-macos-startup.md).
[Rail empty-history read repair and paired measurements](perf-rail-read.md).

### R24 idle App observer

`perf-idle` implements the six-phase release observer; its Linux tests establish parsing and comparison only. **No native idle measurement or calibration is recorded here.** Existing budgets and ADR 0001's WKWebView remain unchanged. #3777 delivered release-profile acceptance; its implementation #3807 must merge before a real calibration. Apply R27's host-split policy above before code work.

```text
Linux: recorded samples → protocol/membership/accounting/limits/report tests
Mac:   isolated release App → ten: focused → unfocused → hidden
                              one: focused → unfocused → hidden
       → Activity Monitor cross-check → cursor attribution → calibration
```

An authorized local agent checks out the implementation commit named in the
separate measurement work order, installs the frozen dependencies, and verifies
#3807 is on that checkout. Stop other builds/tests for the observation. Never use
personal App data, a real vendor executable, sudo, App Nap overrides or the
keystroke/frame workload. `ROUNDUP_ALLOW_WINDOW` must be exactly `1`; both the
recipe and direct executable refuse missing authorization before building,
launching or changing focus, and refuse a non-macOS host even with opt-in.
Linux/CI agents never set it.

Before the round, create `target/perf-idle-host.json` with this schema, replacing
all descriptions with actual host facts (this example is **not evidence**):

```json
{
  "display_power": "display model, resolution, scale and Hz; AC/battery; Low Power Mode; keep fixed for all six phases",
  "release": "source profile settings, toolchain and build configuration after #3807; same binaries for both counts",
  "accounting_verified": "macOS version; verify local top -c d IDLEW interval counts and one-core %CPU; verify footprint -f bytes auxiliary phys_footprint ledger; retain commands/output and tool versions",
  "cursor_enabled": true
}
```

Verify the host's local `man top` and `man footprint` against those commands and
retain that verification beside the report. The observer refuses unknown formats,
missing metrics and denied commands; never interpret them as zero. Platform
`top` uses `-c d` for interval event counts and one-core CPU; the initial block
has invalid since-launch accounting and is discarded. `-F -R` avoids framework
and memory-map traversal during CPU sampling. All included PIDs are selected by
repeated `-pid PID`; each block must contain all of them. Receipt timestamps
supply elapsed intervals, including nonuniform ones; gaps above 2.5 s invalidate
the phase. At least 60 s of subsequent intervals is required. Only after top is
stopped does `footprint -p PID -f bytes` acquire each per-process auxiliary
`phys_footprint` ledger. Its `phys_footprint_peak`, RSS and derived totals are not
accepted. Formatted K/M/G values use binary units; reports use decimal MB.

Exact release commands (the recipe runs these after its guards):

```sh
pnpm install --frozen-lockfile
VITE_ROUNDUP_IDLE_PERF=1 pnpm --filter desktop exec vite build --outDir "$PWD/target/perf-idle-dist" --emptyOutDir
TAURI_CONFIG="$(jq -nc --arg dist "$PWD/target/perf-idle-dist" '{build: {frontendDist: $dist}}')" \
  cargo build --release -p rupd -p rup -p desktop \
    --features desktop/custom-protocol,desktop/idle-perf --target-dir target/perf-idle-app
cargo build --release -p perf --bin perf-idle
ROUNDUP_ALLOW_WINDOW=1 just perf-idle --host target/perf-idle-host.json
# Or reuse that exact build without rebuilding:
ROUNDUP_ALLOW_WINDOW=1 target/release/perf-idle --host target/perf-idle-host.json
```

The commands above are a **needs-mac handoff**, never instructions for a Linux
Builder. Allow roughly ten minutes plus state changes. Each console prompt names
the Agent count and requested state. Focus the selected Terminal with its normal
blinking cursor; for unfocused, focus another window while leaving roundup fully
visible; for hidden, use native App hide. Do not type into the workload. The
observer waits for actual native/webview evidence, then settles at least five
seconds and samples. It retains transitions, output and non-idle Status as errors.
After ten Agents it removes nine, retaining the same selected Agent/Terminal.
Renderer, CSS/physical dimensions, scale, executable hashes and declared
configuration must agree. Hidden `document.visibilityState` is recorded as
observed: an AppKit hide receipt does not imply a hidden webview document.
After the final sample, unhide, wait five seconds and quit only this run's App
normally within the prompted deadline; the final renderer checkpoint must drain
before exit. A kill, timeout, partial journal or missing checkpoint is exit 2.

Process discovery uses installed sysinfo inventories/start identities and a
read-only libSystem responsibility query through Python's standard `ctypes`.
The [same platform lookup is used by Chromium](https://chromium.googlesource.com/chromium/src/+/refs/tags/134.0.6998.28/base/process/process_info_mac.mm).
It admits roundup, its owned rupd and every associated WebKit WebContent/GPU/
Networking helper once, including XPC helpers parented by launchd. Vendor/shell
children and unrelated helpers are excluded. Shared responsible ancestors cannot
prove ownership: when a direct executable launch inherits a terminal's
responsibility and a reparented helper has that same ancestor, collection refuses
with unresolved ownership rather than counting another App's helpers. A missing
platform symbol also refuses. Retain that failed round; repair an unsupported
host association in a scoped observer Issue rather than using sudo or guessing.
Absent helper roles have explicit inventory evidence; PID loss/reuse or changed
membership invalidates the observation. Each top block also checks the complete
WebKit start-identity inventory, so a helper born during sampling cannot be hidden
by the fixed PID selection; any change, including an unrelated helper, conservatively
invalidates the phase and retains the inventory.

Recipe build failures retain command traces, stdout/stderr, actual build status
and an exit-2 report under `target/perf-idle-build.XXXXXX/`.
Each attempt needs a fresh destination, for example
`--out target/perf-idle-round-2.json`. Never delete or overwrite a failed round.
The default report is `target/perf-idle.json`; its exclusive sibling directory
`target/perf-idle.evidence/` holds:

| Raw evidence | Meaning |
|---|---|
| `host.json`, `command-NNNN.{json,stdout,stderr}` | Declared settings; exact command/args, monotonic acquisition start/end, actual status or spawn/deadline error, unmodified output |
| `app-idle.jsonl`, App/Daemon stdout/stderr, `lifecycle.json` | #3862's sequenced native/application/webview records, completion checkpoint and run-owned cleanup outcome |
| `fake-launches.jsonl`, `setup-COUNT-TERMINAL.json` | Fake launch evidence and pre-sample Terminal setup output (including blinking-block cursor sequence) |
| `inventory-N.json` | Complete process inventory, starts and responsibility results; excluded PIDs retained |
| `COUNT-STATE-top.{json,jsonl,events.jsonl,stderr}` | Exact delta-mode argv/status, each raw line with observer receipt time, sequenced Daemon events and stderr |
| `COUNT-STATE-timing.json`, `COUNT-STATE.json`, output reads | Stable interval bounds, measured phase and output cursors; footprint commands have per-PID acquisition bounds |

Observer time is monotonic seconds from before App launch. Producer `at_us` and
renderer `at_ms` have separate origins; the first App receipt bounds the native
origin and renderer time is bounded by launch and receipt. Any invalid event whose
possible time overlaps the stable interval invalidates it, even if delivered
only after unhide. No convenient endpoint can erase a transient change.

Stdout and the JSON report retain all six phase slots, values, raw paths, limits,
source commit, executable SHA256 hashes, release/host/tool facts and every failure.
Incomplete or invalid observations take exit 2 precedence over numeric misses,
which remain listed. Valid unfocused/hidden phases require tree CPU strictly below
0.5% of one core and each PID at most one idle wake-up/s. Focused figures have no
invented numeric ceiling. Paired states report ten/one ledger bytes and
`(ten - one) / 9`, including negative results. Provisional memory aims are strictly
below 300,000,000 ten-Agent bytes and 10,000,000 extra bytes per Agent in every
state; a valid miss exits 1 and never rewrites a budget. Numeric success exits 0
with native validation/calibration explicitly pending.

[Mac measurement #3939](https://github.com/roundup-app/roundup/issues/3939)
requires the same-run, same-PID Activity Monitor
Memory and Energy cross-check with units, refresh intervals and timestamps;
explain rounding/timing differences, and leave unexplained disagreement incomplete.
Energy Impact is neither CPU percentage nor wake-up count. Use Web Inspector
Timelines or Instruments with cursor enabled/disabled to attribute focused wakes.
Retain all six release reports and repeats, then confirm or reset the initial
memory aims here with justification. File measured repairs in their owning
modules with same-observer/same-Mac before/after evidence; #3802 consumes these
measurements and this observer selects no allocator.

Release profile measurements: [code generation comparison](perf-release-profile.md).

### R23 correlated write capture (#3976)

[Correlated capture, adapter timings, probe isolation and remaining attribution gaps](perf-r23-writes.md#r23-correlated-write-capture-3976).

### R23 task/queue execution lifetime (#3991)

[Qualified lifetime, raw task/queue/syscall recordings and executable material](../crates/perf/evidence/r23-queues-40186616032/README.md)
retains both pinned references on Builder 40186616032's exact R16 9V45 host.
[Reproduction](../crates/perf/evidence/r23-queues-40186616032/reproduce.txt) and
[controls/statuses](../crates/perf/evidence/r23-queues-40186616032/controls.md)
include every failed attempt, both prior probe variants against identical
Daemon executables, separate scheduler-only observations and syscall tracepoints
that exclude the recorder's own events. Matching executables, raw records,
PID/TID/FD associations and CLOCK_MONOTONIC task/queue markers are retained.

Each marked capture joins 2200 writes; filtered physical endpoints retain 2200
one-byte PTY writes and reads per reference. Input acceptance is enqueue
acknowledgment. Producer input enqueue remains bounded by user-call entry and
acceptance return; output publication remains bounded by physical PTY read exit
and forward receive. Delegated wake markers precede logging and original wake,
and selected-future polls are not whole-runtime task polls. CPU execution,
thread runnable delay, physical blocking and unresolved runtime-task delay stay
separate. Observer-perturbed stages cannot be transferred to clean p95s.

[#3983 interval assessment](../crates/perf/evidence/r23-assessment-40190149199/README.md)
joins all 2200 filtered writes per reference and separates selected-future polls,
delegated wakes and thread scheduler states. Both dispatch futures return ready
on their first selected poll for all writes. Producer enqueue, initial dispatch
scheduling, exact runtime enqueue and observer overhead remain explicitly bounded;
no dominant cause is established. #3760 and #3720 retain their full acceptance.
The six original clean observations, #3982's four controls/recordings and #3975's
offline extraction are reused. No new clean pair, aggregate CPU table, stage p95,
calibration, baseline, production repair or Mac observation is supplied.

### R23 producer/dispatch continuation (#4032)

[Builder 40212001837](../crates/perf/evidence/r23-host-40212001837/README.md)
retains an unchanged exact-model qualification miss: AMD EPYC 9V74, exit 2.
Commands, actual statuses, runner/job identity, matching before/after boot IDs,
load/background processes, toolchain, shell and settings are retained. Runner
inventory returned HTTP 403 (exit 1); available job metadata and launch inputs
identify no accessible qualified target. No producer/dispatch collection or
controls ran. #4032 remains incomplete; this miss supplies no timing observation,
attribution or overhead bound.


[Builder 40208780160](../crates/perf/evidence/r23-host-40208780160/README.md)
retains an unchanged exact-model qualification miss: AMD EPYC 7763, exit 2.
Original commands, statuses, runner/job identity, matching before/after boot IDs,
load/background processes, toolchain, shell and settings are retained. Runner
inventory returned HTTP 403 (exit 1); available job metadata and launch inputs
identify no accessible qualified target. No producer/dispatch collection or
controls ran. #4032 remains incomplete; this miss supplies no timing observation,
attribution or overhead bound.

[Builder 40206540231](../crates/perf/evidence/r23-host-40206540231/README.md)
retains an unchanged exact-model qualification miss: AMD EPYC 7763, exit 2.
Before/after boot IDs match; original commands, statuses, load/background processes,
toolchain, shell and settings are retained. Runner inventory returned HTTP 403
(exit 1); current job metadata and launch inputs identify no accessible qualified
target. No producer/dispatch collection or controls ran. #4032 remains incomplete;
this miss supplies no timing observation or overhead bound.

[Builder 40204505975](../crates/perf/evidence/r23-host-40204505975/README.md)
retains another unchanged qualification miss: AMD EPYC 7763, exit 2, with
matching before/after boot IDs and actual command statuses. Runner inventory
again returned HTTP 403 (exit 1); available job metadata and existing launch
inputs identify no accessible qualified lifetime. No build or collection ran.
This host-only report leaves producer/initial-dispatch attempts, isolated
repeated controls and their assessment incomplete; it supplies no overhead bound.

[Builder 40200071512's retained qualification](../crates/perf/evidence/r23-producer-40200071512/README.md)
passed on an exact 9V45 host, but its build job ended with failure at
2026-10-25T14:24:52Z without retaining producer/initial-dispatch capture,
repeated controls or assessment. That lifetime is no longer collecting.
[Fix run 40202162343](../crates/perf/evidence/r23-host-40202162343/README.md)
retains a new exact-model qualification failure: AMD EPYC 9V74, exit 2.
Runner inventory returned HTTP 403 (exit 1); existing launch inputs and job
metadata identify no accessible qualified target. No new build or collection ran.

#4032 remains the execution prerequisite of #4031 under #3760 and #3720.
The linked continuation report retains commands, statuses, boot/runner identity
and the outstanding producer, initial scheduling and observer-overhead boundaries.
The original six clean observations remain the timing evidence; this continuation
changes no per-metric conclusion and supplies no attribution or overhead bound.
No baseline, calibration, production repair or clean R16 verdict is claimed.

### Terminal readiness repair and U3800 Mac handoff (#3841)

The [previous Mac attempt](https://github.com/roundup-app/roundup/pull/3772#issuecomment-6390588594) produced four
exit-2 observations: three setup failures and one reverted diagnostic. No drag setup/actions, three-pair comparison or App
compatibility qualification completed. Those failures remain evidence; readiness fixtures supply no native timing pass.

`terminalReady` now owns Workstream creation → Agent input → one shell-open → shell input → complete shell readiness.
Keystroke and all frame workloads, including the native compatibility probe, call it; idle observation drives no Terminal.
The selected bubble supplies the shell id. Parsed output and retained `terminal.read` independently recognize complete lines,
so a late screen snapshot need not contain `ready`. Agent output and live/read overlap cannot select another report target.
Each setup step retains its 10 s bound; missing readiness performs no measurement. Without a report target, the failed step
rejects rather than replacing it with a generic reporting error; collection still exits 2 with raw output and launch logs.
R3841 fixtures cover delayed Agent input at both entry points, both readiness orders, paginated retained output, shell identity
and missing Agent/input/line. The unique R20 split/parsed-output and key-routing proofs remain. They replace the duplicated
`u3010e_the_report_target_is_the_terminal_that_printed_ready` proof. P9's observer remains the fake-vendor sentinel; no Model
turn, production Terminal/drag behavior, build opt-in, isolation, timing budget or collection bound changes.

Mac request: qualify the current #3772 candidate below, superseding the earlier **unmeasured** `3e6a9bd91` attempt. Use the
same M4 Max, dense drag fixture, 64 KiB/s stream, fixed display refresh, AC/Low Power Mode off and load policy from the
[native runbook](motion-native-runbook.md). Keep the screen awake/uncovered and stop builds before sampling. Posting CGEvents
is already authorized on this Mac; use them to perform sibling, nested, outdent and Escape actions, retaining counts and outcomes.

| Identity | Full SHA |
|---|---|
| Base source (#3772's merged-main parent) | `3d224def071626e2ed1528a11d9d6e2f6303d2b3` |
| Candidate source (#3772 head) | `2863633ddd508bd7a6f227286ca5f3b32c242258` |
| Readiness observer revision | `a575c56c44e189b2808dae540b272199f69f8496` |

From a repository containing these commits, prepare fresh, separate checkouts. The frame driver copied to base is measurement
setup/action accounting only; never copy candidate production drag files. Retain that transfer separately from readiness:

```sh
base=3d224def071626e2ed1528a11d9d6e2f6303d2b3
head=2863633ddd508bd7a6f227286ca5f3b32c242258
repair=a575c56c44e189b2808dae540b272199f69f8496
qualification=$(mktemp -d /tmp/roundup-u3800.XXXXXX)
git worktree add --detach "$qualification/base" "$base"
git worktree add --detach "$qualification/head" "$head"
git show "$head":apps/desktop/src/perf/frame_run.ts > "$qualification/base/apps/desktop/src/perf/frame_run.ts"
git -C "$qualification/base" diff -- apps/desktop/src/perf/frame_run.ts > "$qualification/base-driver.patch"
git diff "$repair~2" "$repair" -- apps/desktop/src/perf/run.ts apps/desktop/src/perf/frame_run.ts > "$qualification/readiness.patch"
for side in base head; do
  git -C "$qualification/$side" apply --check "$qualification/readiness.patch"
  git -C "$qualification/$side" apply "$qualification/readiness.patch"
  (cd "$qualification/$side" && pnpm install --frozen-lockfile)
done
```

Linux verified the patch applies to both sources and yields identical observer files. Readiness patch SHA256:
`65c8dd82ff042e72b0837dbe83d81bbf3e82a648a5f85ab2642985586877c124`.
Both checkouts' `run.ts` SHA256 is `17db62ae0c3735553c1b5dc0d7b9efc7d3f556c612dd4c24629c2731f8343873`;
`frame_run.ts` is `017cae7dee289546cf8a1ee110ff6b988fde3edb70b938dc12f528de6c9c4d30`.
Record source SHAs **plus these patches**, dirty status, toolchain/OS/WebKit, display/power/load and executable hashes.

Build each checkout once with `ROUNDUP_ALLOW_WINDOW=1 just perf-frames drag`; retain these calibration attempts too.
Then stop builds and run three alternating base/head pairs. In each checkout, for each uniquely named attempt:
`ROUNDUP_ALLOW_WINDOW=1 target/release/perf-keystroke --frames --out target/u3800-pair-1-base.json` (substitute pair/side).
This uses the exact build from `just perf-frames drag` without rebuilding during sampling. Keep 10 s warmup, 60 s sample,
30 s idle and existing action cadence/bounds. Retain every report, evidence directory, command, stdout/stderr, exit and repeat.
Missing setup or completed native actions invalidates the sample. Compare scheduling p95 ≤1.5P, p99 ≤3P, >1.5P rate ≤5%,
max ≤50 ms and head/base regression ≤10%. A measured miss fails (1); absent/invalid stages remain incomplete (2).
Do not substitute scheduling for presentation; retain native stage evidence per the runbook or mark it unmeasured.

For actual App compatibility, build the candidate checkout **without perf flags** into a separate target/dist:

```sh
cd "$qualification/head"
pnpm --filter desktop exec vite build --outDir "$PWD/target/u3800-app-dist" --emptyOutDir
TAURI_CONFIG=$(jq -nc --arg dist "$PWD/target/u3800-app-dist" '{build:{frontendDist:$dist}}') \
  cargo build --release -p desktop -p rupd -p rup --features desktop/custom-protocol --target-dir target/u3800-app
mkdir -p "$qualification/app-data" "$qualification/project"
ROUNDUP_DATA_DIR="$qualification/app-data" ROUNDUP_CLAUDE_BIN="$PWD/crates/rup/tests/e2e/fake_claude.py" \
  target/u3800-app/release/roundup "$qualification/project"
```

Use only this temporary Project/fake vendor. Keep Tauri file-drop enabled. In the actual App, test Rail, Todo and Pad drag,
nested drop, Escape, travel <4 px (click), keyboard reorder and two real files dropped into a Terminal. Record resulting
order/parent, commit counts, focus, click behavior and identical ordered absolute paths delivered once, with no row reorder
from the file drop. This requests no repeat of the separate Pragmatic probe. A compatibility failure fails the candidate;
missing observations leave qualification incomplete. Quit only this App and retain owned-child cleanup evidence.
Publish returned results to #3772, its drag work Issue #3540 and #3841; leave failures and unmeasured stages visible.

### Full-chain flood recorder

`ROUNDUP_ALLOW_WINDOW=1 just perf-keystroke --flood --out target/perf-keystroke-flood.json`
selects a separate, App-opened, run-owned `/usr/bin/yes roundup-flood` Terminal
beside the same 1000-key full-chain observer. The default remains idle typing.
Reports retain the flood Terminal's visible/folded state, raw byte offsets,
measured output rate and every run's diagnostics. Missing, exited or silent
producers and build/runner workload mismatches invalidate the observation.
See [workload conditions and retained evidence](perf-keystroke-attribution.md#full-chain-output-flood-r20r21-recorder).

The no-window implementation does not measure or repair #3550's 129–136 ms
flood slowdown. Its native flood observation follows this implementation's
merge; the valid quiet idle baseline above cannot choose that repair.

### Native scheduler and producer identities (#4120, R23)

[Capture, argument validation and replay](../crates/perf/evidence/r23-identities-40227852264/README.md)
retain both archived pins on hosted job 40227852264. Local/remote scheduling
samples recover TaskMeta IDs through the emitted header/vtable access sequence;
2200 physical write ordinals join per pin. Candidate byte-broadcast send has
2211 separate entry/return hits at its true symbol entry, excluding send+217;
2200 match the paced PTY bytes and stream offsets. Observed pointer reuse is
retained; neither worker TID nor allocation pointer substitutes for task identity.

Two probe sets each retain their own three alternating off/on pairs per
pin/common-or-marked observer, fixed archived executable/hook/logger bytes,
backgrounds, loads and all statuses. The first set omitted the actual ID offset;
the corrected set recovers it. All 48 invocations are R13-qualified and exit 1
against diagnostic ceilings; a 1685.683182 ms cold-start absolute miss remains.
Ranges describe aggregate variation, never per-stage corrections. No diagnostic
interval or p95 difference is subtracted from clean p95s.

[#4031](https://github.com/roundup-app/roundup/issues/4031),
[#3760](https://github.com/roundup-app/roundup/issues/3760) and
[#3720](https://github.com/roundup-app/roundup/issues/3720) still lack exact
executor insertion/publication observations and separation of build/hook/logger
work from useful-task CPU. Function entry/return supplies bounds, not
linearization. Pending-read idle exclusion, overlapping branches and the
selected-future/full-poll distinction remain. The original six clean observations
are history only; this investigation creates no clean R16 verdict or baseline.

C9 release artifacts, dependency attribution and remaining acceptance: [release sizes](release-size.md).

## Plugin materialization check for #4196

The reported plugin miss was not reproduced by the permitted current-main R16 pair on 2026-10-26. `just perf` exited 0: every metric passed, no comparisons were skipped, and both eleven-Daemon invocations used 1000 calls. The complete report is [perf-linux-7763-plugins.json](perf-linux-7763-plugins.json). This is a same-job comparison on `linux-8573c`, not a new 7763 calibration or a claim about the earlier VM. No implementation repair is indicated by this pair. Plugin materialization: base 7.583291 ms; head 7.519237 ms; paired ceiling 8.3426201 ms; absolute limit 300 ms.
Both immutable references are `f1f59fb1d218120f3f2e321a64e480686f9a88a0` (current main and its merge base at invocation), built separately with Rust 1.99.0 and the unchanged locked release settings. Host `runnervmtai0g`, boot `75d56492-f160-4056-8ff2-2e813bf4296d`, session `40298544515/1/build`: Ubuntu 24.04, Intel 8573C, four online/available CPUs and affinity `0-3`. Base/head median loads were 3.77 and 2.91 on four CPUs. The common observer SHA-256 is `01d2b1ffc5443e1d36b590bacd225b26f676f888c7ab1c35f55fa4f8293aac15`; Daemon, CLI and sidecar hashes match across the two isolated builds. All hashes, samples, verdicts and commands are in the report. The 7763 baseline 11.940635 ms, stored ceiling 13.1356985 ms, 300 ms limit and every other budget remain unchanged.
Raw evidence: [Builder 40298544515](https://github.com/roundup-app/roundup/actions/runs/40298544515), job `build #4196 / build`, artifact `answer-4196` (publication follows the run). Its `perf-4196.tar.gz` has SHA-256 `9bc32eb651d921fc0e89e9d5028dc2c9ec0aa9422d7c96aa67839dd5a97a679d`; its README and SHA256SUMS enumerate the original output, command/build logs, observer metadata, both invocation reports, all startup logs and actual exits. No failed observation was discarded.
Validation: `pnpm install`, `just lint-web`, `just lint-rust` and `cargo nextest run -p agents --test plugins` exited 0. All six ordinary Q11 tests passed; the existing real-Claude test remains ignored because it requires `ROUNDUP_CLAUDE`. No plugin bytes, modes, registration, validation or launch code changed.

## R4229 startup headroom

Clean paired builds on Linux x86_64 (`runnervmtai0g`), Node v22.23.3/pnpm 10.14.0: base `6db8b27bda83f7b3c21a1f6d6088156dbd1a90b4` = **437,808 gzip bytes** (1,388,635 raw); implementation `6c19d0a20767f73e8a2f0bdc3a12122aff71eb0a` = **422,146 gzip bytes** (1,329,400 raw), saving **15,662 bytes**. Both checkers exit 0 against the unchanged 437,814 ceiling. Later test/evidence commits change no production input.

Measured moves: ImportPanel alone grew the closure by 1,491 to 439,299 (checker exit 1), so it was discarded. Deferring OrderDrawer at its three production callers saved 15,662 relative to base; a clean committed-head rebuild reproduced 422,146. Solid's existing `lazy` and native dynamic imports defer the Order editor and progress view until shown. Shared chunks remain counted: `index-BIzfQbNs.js`, `copy-CGbSrKPM.js`, `ReservedLine-BMsOCD5R.js`, `floating-ui.dom-vtOd0C_f.js` (all under `assets/`). No budget, observer, compression, dependency or bundler configuration changed; drag remains eager and Terminal remains lazy.

Reproduce in separate base/head worktrees with identical environment: `pnpm install --frozen-lockfile`; remove each `apps/desktop/dist`; `pnpm --filter desktop build`; `pnpm --filter desktop run check:startup`. Each install/build exits 0. Raw reports for every attempt, logs, commands, observer hashes and final revision metadata: [Builder 40319239117](https://github.com/roundup-app/roundup/actions/runs/40319239117), job `build #4229 / build`, artifact `answer-4229`, `r4229-measurements.tar.gz` SHA-256 `d1685adf27de76673d61c3a2ff01e84fdd637333d1f6e0df1d61a2fff82f1eb1` and directory `r4229` (published after this run). Existing affected behavior observers, R3800 startup tests and rendered Order/progress observers cover first opening, editing, recovery, dismissal and focus; no tests are weakened or removed. All 68 Order/progress tests and the six R3800 shell tests pass. Dark 1512×950 first-open/edit/Escape observations call each opening read once; P3557c’s rendered failure/dismissal observer passes D2/D5/D6. The opt-in U3078i earlier-expansion capture times out on both base and head; its failed attempts are retained too.

## R20 recorder startup isolation (2026-10-28)

The Mac flood observation at `5b36bf532dc45e53d818a727e67423acd51ecd3a`
exited 2 on all three runs: the App exited 0 before opening its Daemon socket,
with empty stdout/stderr. The machine was an M4 Max, 16 cores, macOS 26.0.1,
AC power, Low Power Mode off, unlocked, load/CPU ≤ 0.33. The full failed
reports and commands remain in [#3550](https://github.com/roundup-app/roundup/issues/3550#issuecomment-6477777448).

The native single-instance plugin is an early exit-0 path: it forwards launches
using a socket derived from the Tauri identifier, before Project setup. The
perf data-directory override previously kept the installed App's identifier.
`Config::context` now scopes that identifier to the absolute overridden data
directory, using a bounded standard-library hash suffix. Different profile paths receive distinct derived identities; reopening the
same profile in this build retains its identity. The normal App with no data override retains its identity.
`r20_perf_profile_does_not_share_the_installed_apps_singleton` reproduces the
shared identity before this repair and checks isolation afterward, without
starting an App, Daemon, browser or window.

This removes a concrete collision path, not proof of which process answered
the socket on that Mac. After this repair merges, one invocation of
`ROUNDUP_ALLOW_WINDOW=1 just perf-keystroke --flood --out target/perf-keystroke-flood.json`
on the quiet Mac decides whether startup now reaches the flood/hop report.
Retain all three reports, exit code, logs and machine/power/load evidence.
No new latency measurement, dominant-hop choice or R21 pass is claimed here;
the full acceptance remains open on #3550.

## R20/R21 flood duplicates and scheduling (2026-10-29)

The [retained Mac baseline and repair limits](perf-keystroke-attribution.md#flood-duplicates-and-scheduling-repair-2026-10-29)
record `04bafbf18`'s 43–45 ms p95, zero drops and three invalid duplicate-sample
verdicts. The recorder now permits repeated observations with growth across
the window. Output delivery yields in Rust, and live xterm parsing takes one
8 KiB chunk at a time. No after-repair Mac distribution or <16 ms claim exists
yet; #3550 remains open for the same three-run flood observation and full acceptance.

## Switcher-open and switch budgets (SP1 to SP8, #5248)

Two budgets on macOS, key press to DOM, measured in the real App's webview by `just perf-keystroke` (SP4) and held in `crates/perf/keystroke-budgets.json` (SP5), not in `budgets.json` (R7): the Switcher opens in under 80 ms p95 (`switcher_open_p95_ms`) and switching to another Agent or Terminal takes under 32 ms p95 (`switch_p95_ms`). AGENTS.md rule 7 is unchanged. Outside evidence, not a baseline: the owner measured Rex on the Mac, a palette open in 66 ms and a tab switch in 17 to 23 ms.

The runner (`judge_switch`, `crates/perf/src/webview.rs`) takes `switcher_open_p95_ms` and `switch_p95_ms` from the report's PERF line, each with `{n, dropped}` under `switcher_open` and `switch`. A report with the webview's error, a mean frame time above 25 ms, a missing metric or more than 5% of either kind dropped exits 2; each metric is the median over `--runs`; one over its limit exits 1 naming it, its value and its limit, and one more than 10% over a macOS baseline exits 1 naming the baseline. Neither metric has a baseline until a recorded Mac run adds one (SP5).

What CI checks (SP8): the probe is absent from a normal build, the marks record the specified intervals under a fake clock, and the budget file and runner refusals hold. What only a Mac gives (SP7): the 80 ms and 32 ms readings. `just perf-keystroke` drives the open and switch workloads (SP4) in the idle run and judges both metrics with `judge_switch`. Implementation order was #5249 (App marks), #5315 (the SP4 driver), then #5250 (limits); a baseline is added after the first recorded Mac run, and the 10% regression test then applies.

## R5594 startup headroom

Paired clean builds on Linux x86_64 `runnervm48cm3`, Node v22.23.4 and pnpm 10.14.0:

| Revision | Raw bytes | Gzip bytes | Checker exit |
|---|---:|---:|---:|
| B `5307469e18b650bca8297bbfd782cbbb72b89e23` | 1,369,334 | 435,692 | 0 |
| Production H `d41c839fa042a4ab025cfd29b41accd3f6eee984` | 1,278,789 | 411,916 | 0 |

The reduction is **23,776 gzip bytes**, exceeding 16,384 by 7,392. Headroom is **25,898 bytes** under the unchanged 437,814 ceiling. The final pair follows a conflict-free merge of main's scenario-only PR #5592; earlier attribution at `4433b54af` has identical production inputs. Later commits change only this evidence. No dependency, bundler, counting, compression or budget configuration changes.

Before selecting deferrals, the production manifest, `.vite/modules.json` and installed visualizer attributed the largest static chunks:

| Chunk stem | Gzip bytes | Contents keeping it eager |
|---|---:|---|
| index | 141,412 | App, settings editor/Select, Rail, changed-file views, Capture |
| BulkDelete | 65,107 | Pad editor, ItemDrawer, TreeView, Editable, eager dnd-kit |
| shownTodos | 42,194 | Todo editor, metadata, comments, refs, pickers, Combobox |
| drawer | 39,200 | Drawer state, Dialog, focus/keys, Tooltip, ReservedLine |
| APQX6POG | 24,990 | motion-dom/motion-utils |
| CopyButton | 23,089 | connected Project state, events, Rail state, clipboard |
| preferences | 19,572 | Tauri, storage, contract discovery, preferences |
| scrollHover | 18,563 | OverlayScrollbars and styles, Terminal links |

Static paths included App → TodoHost/PadHost, Switcher → those editors, Inbox → TodoHost, toast watch → both editors, TodoRefs → PadHost, and DraftRecovery → PadDrawer. Native Solid `lazy`/dynamic imports now cut those paths. Recovery loads TodoDrawer directly instead of depending on its eager module-registration side effect. Shelf editors were already behind the Shelf's dynamic modules. Drag and shared infrastructure remain eager; Terminal remains lazy. No new loading/failure presentation is introduced.

| Attempt | Gzip total | Reduction from B | Disposition |
|---|---:|---:|---|
| Settings editor | 428,642 | 7,050 | Discarded |
| Settings + changed-file tree/diff + note split | 422,364 | 13,328 | Discarded; note recovery mounted immediately |
| Above + Pad editor | 418,400 | 17,292 | Discarded |
| Settings + changed-file tree/diff + Pad, notes eager | 422,580 | 13,112 | Discarded |
| Above + Todo editor | 400,525 | 35,167 | Discarded in favor of smaller scope |
| Todo + Pad only, before final recovery cleanup | 411,924 | 23,768 | Superseded |
| Committed Todo + Pad only | 411,916 | 23,776 | Selected |

All measurement commands above exited 0. Experiments also exposed a settings Suspense regression and changed-file observer failures; those production changes were discarded. The optional Todo failure capture used a checkbox selector retired on main; its selector now follows the existing metadata checkbox, preserving the same actions and assertions. No test was removed or weakened.

Reproduce B and H in separate worktrees with their locked dependencies: `pnpm install --frozen-lockfile`; delete each `apps/desktop/dist`; `pnpm --filter desktop build`; `pnpm --filter desktop run check:startup`. Install/build/check all exit 0 for the final pair. Both use B's identical observer (SHA-256 `f003a907a3aa4508fbbc34425fa28f41231c757fdfffff14aafb9351419042f4`) and ceiling file (`cc4385480a849659725f4019cf58b40e26f9546c3b79d0e81fda7271089be49c`).

Raw commands, exit codes, counted-file reports, module attribution, visualizer output, failed attempts and validation logs are retained in [Builder 41378367430](https://github.com/roundup-app/roundup/actions/runs/41378367430), artifact `answer-5594`, directory `r5594`. Existing Pad/focus/keyboard/Switcher/toast observers pass 173 tests; Todo/recovery observers pass 96; the final Todo/ref/recovery/R3800 shell/lazy-Terminal group passes 45, and startup-checker tests pass 3. Dark 1512×950 `U3760` captures pass D2/D5/D6; Todo and Pad failure visibility and clearing pass the rendered P3557c observers, with D2/D5/D6 passing in every retained dark editor/failure capture. Full required CI lanes remain the merge gate.
