# Release profile runtime comparison

The release profile must meet runtime budgets as well as C9's executable-size cap. This acceptance belongs to #4175; it specifies observations and any measured repair, without claiming a performance pass.

Checks on main:

1. Absolute limits, comparison noise and pinned baselines (`scenarios/perf.md`, R8 the committed budgets and R9 boundaries; `crates/perf/src/budget.rs`, `judge`).
2. Load-qualified comparisons and loud skips (`scenarios/perf.md`, R13 load-aware comparison; `crates/perf/src/budget.rs`, `judge_all`).
3. One-host paired builds and machine identity (`scenarios/perf.md`, R16 Linux Builder regression observer; `crates/perf/src/paired.rs`, `Environment`).
4. One observer and retained evidence per comparison (`scenarios/perf.md`, R26 a perf repair compares one observer on one host).
5. Host-specific execution prerequisites (`scenarios/perf.md`, R27 perf work names its execution host before code work).
6. Release settings, size and completion evidence (`scenarios/perf.md`, C9a workspace release profile, C9b release Daemon below 15 MB and Release artifacts).
7. Real-webview typing and its authorization (`scenarios/perf.md`, R11 what the runner accepts, R12 the window needs a yes, R20 each keystroke hop is timed; `justfile`, `perf-keystroke`).

All then-clauses below are **policy**, observed through retained real release measurements and review of their inputs. Configuration-copy tests, synthetic timing values and a specification merge cannot establish these outcomes.

**R4175a distinct reference and head on one host.** Given the pre-profile reference `ad42a7649686df7ee3b566129078c9e39ae33210` (the first parent of the merged #4150, `1d6bbeb43b9c6e53e6d1cfe665ef0605db411a0d`) and the implementation head, when their release `rupd` and `rup` are built separately and measured with `just perf`'s workload, then retain a completed before/after pair on one physical host in one job/session, using one toolchain, identical observer bytes and arguments, and eleven fresh Daemons per invocation. Finish both builds before measuring; retain binary hashes and effective release settings. Preserve the full head SHA. An automatic pair whose merge-base already contains the profile change does not replace this historical reference; a base equal to head proves only a noise floor.

Retain both raw reports, startup logs, command output and exit codes. Show every metric and unit side by side, including `cold_start_ms`, with its absolute limit and `reference * 1.10 + noise` ceiling from the unchanged budgets (zero noise when absent). Apply the existing load and machine-class rules; an unskipped pair is required before claiming no regression. The cold-start interval is process spawn through the first successful `daemon.ping`, not build duration or socket creation. A secondary timer supplies diagnosis only unless it measures that same interval against those same binaries on that host.

**R4175b same-Mac startup and parser-path typing.** Given the same reference and implementation head, when both are measured on one Mac in one session, then retain the same paired `just perf` evidence for macOS, including unskipped `cold_start_ms` comparison, and the real release App's keystroke-to-render comparison through `just perf-keystroke`. Use the same probe, workload and arguments for both Apps, retaining each run's raw report, p95, dropped-key count and available hop attribution. Each run meets the existing keystroke limit and drop rules; also compare reference/head p95 with the 10% plus existing noise rule. The keystroke budget currently has no noise allowance. Daemon `write_to_output_p95_ms` does not substitute for webview keystroke-to-render.

Observe the existing Terminal input/output path that feeds `crates/terminal`'s `vt100`/`vte` parser, identifying the production parser calls and effective release optimization for those packages in the evidence. If a profile or timing comparison shows a regression there, use the existing hop attribution and a same-source release-profile control to distinguish parser cost from other changes before choosing a repair; a standalone parser microbenchmark alone does not complete the typing outcome.

Use an available authorized macOS execution host. Existing CI history counts only when retained reports identify the required reference/head binaries, host/session, interval and actual metrics; a passing macOS test lane or release-size artifact alone is not a cold-start comparison. Follow Check 5 for unavailable hardware, using scoped measurement prerequisites and native Issue dependencies before repair code. Only a check that the user's Mac alone can produce uses the Builder's Mac-observation request. Keep progress and execution questions on the Issue.

**R4175c measured repair preserves release constraints.** Given the comparisons above, when cold start, typing or another existing perf gate regresses or exceeds its budget, then repair the measured cause and repeat the affected reference/head comparisons on the required hosts until the unchanged gates pass without skips. A package-specific release optimization for the parser packages is a candidate, not a mandated implementation. Retain the failing pair, diagnosis, any same-source control, repair commit and final passing pair. Do not raise baselines, allowances, load thresholds or limits, change the workload to avoid the parser, or substitute development-profile timings.

The final release retains C9a's LTO, stripping, single codegen unit and unwind recovery, and its complete workspace-stripped native `rupd` remains below C9b's 15,000,000-byte cap on Linux and macOS. Run the existing release-size observer on those actual artifacts; no separately stripped copy establishes this result. Retain commands, target, toolchain and byte counts. If all original comparisons pass, retain that evidence without speculative code changes.

## Evidence and completion (policy)

Commit a concise report under `docs/` with the metric/unit, reference/head values and full SHAs, exact build and observer commands, effective Cargo settings, host class, physical host/boot identity, run/session identity, load qualification, binary hashes, exit codes and durable raw-report locations. Follow Check 4's same-observer requirement, isolating any probe change against the same binaries. Preserve failed, skipped, cancelled and incomplete attempts as such; they never supply a passing pair.

The existing observers keep their exit contracts:

| Observer result | Exit | Completion meaning |
|---|---:|---|
| `perf` completes every applicable comparison without a miss or skip | 0 | Eligible evidence for that host and those references |
| `perf` exceeds an absolute limit or selected regression ceiling | 1 | Repair required |
| `perf` lacks a required binary, report, metric, load or valid reference/build | 2 | Observer error; repair the collection |
| `perf` skips load-qualified comparisons without a numeric miss | 0 | Incomplete regression evidence; retain and repeat |
| `perf-keystroke` exceeds its latency limit or drops a key | 1 | Repair required |
| `perf-keystroke` lacks authorization or valid required observations | 2 | No typing verdict |
| Release-size checker sees `rupd` at or above its cap | 1 | Repair required |
| Release-size checker lacks a valid requested artifact | 2 | No size verdict |

A terminated command retains its actual exit/signal status (including 143 for SIGTERM), never an invented observer exit or a performance pass. A completed command's exit 0 alone does not prove the additional historical-pair and evidence requirements above. Close the implementation Issue only when all three scenarios' observations and any repairs are delivered. This specification PR leaves it open.
