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

`just perf` runs a fresh Daemon 11 times, takes each metric's median, prints the range and each run's load average, writes `target/perf.json` and exits 1 on a miss. Run it on a quiet machine; retain busy runs with their load and skip reasons, then repeat them without counting them as clean evidence. A metric fails above its `limit`, or above its OS's `baseline` by more than 10% plus its `noise` allowance.

CI build measurements are separate from runtime budgets. Cache lookup, saved-entry download/unpack, compilation, linking and full job duration need separate intervals; a cold-cache rebuild is not cache restore time. A secondary startup timer must measure the same spawn-to-first-successful-ping interval as `just perf`, against the same reference/head binaries on one host. Changing the timer supplies no runtime improvement and changes none of the budgets above.

**Q11's cold plugin materialization.** Each release `perf` run materializes the pinned plugin bundle into a new empty temporary directory. Only `plugins::materialize` is timed; `bundle.validate()` must then succeed or the observer exits 2. The median is printed as `cold_plugin_materialization_ms` and retained in `target/perf.json`. Its rule 7 limit remains 300 ms on every OS at every load. Regression above the recorded Linux baseline by more than 10% plus the clock-resolution allowance fails (exit 1), using the same R13 load rule as other latencies. `just check` verifies empty-directory materialization and validation without a wall-clock assertion (`q11_cold_materialization_produces_a_valid_bundle`).

Q11's Linux baseline is 11.940635 ms, the median of nine eleven-sample release observations on 2026-10-14 (Ubuntu 24.04, four available CPUs, AMD EPYC 7763 64-Core Processor, rustc 1.99.0). The nine medians were 11.889899, 11.971422, 12.378832, 11.931701, 11.680185, 11.874712, 11.944743, 11.940635 and 12.034941 ms (max/median 1.037, min/median 0.978); median load per CPU was 0.60–1.20. The probe is commit `9ff3cf3e` in [#1762](https://github.com/saadshahd/roundup/pull/1762); this baseline applies to that Linux machine class, not macOS. The clock-resolution allowance is 0.001 ms, and R13's Linux threshold is 2.0 load per CPU. The 300 ms hard limit applies even when load skips the regression comparison; macOS has the hard limit until its own baseline is measured. Tests `r8_the_committed_limits_are_rule_sevens_budgets` and `r9_a_value_at_a_committed_limit_passes_and_the_next_one_fails`, `q11_cold_plugin_materialization_rejects_a_release_regression_below_the_hard_limit` and `q11_perf_reports_cold_plugin_materialization_and_fails_an_over_budget_median` exercise the gates with synthetic samples, never clock assertions.

## Perf work and evidence (R25–R27)

The live `contracts::methods::METHODS` table is checked by `r25_every_method_has_a_perf_disposition` against `methods` arrays in `crates/perf/budgets.json` and the JSON list below. Metadata adds no metric and waives no R7 measurement. Off-path is a workload disposition, never a claim that a method is fast. Review a changed method's disposition against its behavior.

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

These exact method keys explain exclusions from the measured workload. Adding a
method without a measured mapping or non-empty reason fails live coverage.

```json
{
  "project.measurements": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.", "project.measurementSummary": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.",
  "deliverable.publish": "Published-output management is user-requested and absent from the Terminal echo and Rail-read workload.", "deliverable.list": "Published-output management is user-requested and absent from the Terminal echo and Rail-read workload.",
  "deliverable.get": "Published-output management is user-requested and absent from the Terminal echo and Rail-read workload.", "deliverable.resolve": "Published-output management is user-requested and absent from the Terminal echo and Rail-read workload.",
  "deliverable.move": "Published-output management is user-requested and absent from the Terminal echo and Rail-read workload.", "deliverable.remove": "Published-output management is user-requested and absent from the Terminal echo and Rail-read workload.",
  "ask.send": "Question delivery and selection are event-driven coordination, outside the measured echo and Rail-read loops.", "ask.list": "Question delivery and selection are event-driven coordination, outside the measured echo and Rail-read loops.",
  "ask.pick": "Question delivery and selection are event-driven coordination, outside the measured echo and Rail-read loops.",
  "daemon.methods": "Connection setup or contract discovery is not a repeated call in the measured workload.",
  "link.read": "External link reading depends on external content and is absent from the isolated perf workload.",
  "daemon.identify": "Connection setup or contract discovery is not a repeated call in the measured workload.",
  "events.subscribe": "Subscription setup is outside the timed calls; write-to-output measures delivery on an already subscribed connection.",
  "provenance.history": "History inspection is user-requested and absent from the measured steady workload.", "provenance.touched": "History inspection is user-requested and absent from the measured steady workload.",
  "terminal.open": "Terminal inspection, presentation or lifecycle control is outside the timed write/echo calls and ten-shell RSS sample.", "terminal.close": "Terminal inspection, presentation or lifecycle control is outside the timed write/echo calls and ten-shell RSS sample.",
  "terminal.resize": "Terminal inspection, presentation or lifecycle control is outside the timed write/echo calls and ten-shell RSS sample.", "terminal.kill": "Terminal inspection, presentation or lifecycle control is outside the timed write/echo calls and ten-shell RSS sample.",
  "terminal.scheme": "Terminal inspection, presentation or lifecycle control is outside the timed write/echo calls and ten-shell RSS sample.", "terminal.show": "Terminal inspection, presentation or lifecycle control is outside the timed write/echo calls and ten-shell RSS sample.",
  "terminal.measure": "Explicit opt-in keystroke attribution and calibration setup/collection, outside timed production input and steady-state workloads.",
  "terminal.list": "Terminal inspection, presentation or lifecycle control is outside the timed write/echo calls and ten-shell RSS sample.", "terminal.snapshot": "Terminal inspection, presentation or lifecycle control is outside the timed write/echo calls and ten-shell RSS sample.",
  "terminal.outputStop": "Terminal inspection, presentation or lifecycle control is outside the timed write/echo calls and ten-shell RSS sample.", "terminal.screen": "Terminal inspection, presentation or lifecycle control is outside the timed write/echo calls and ten-shell RSS sample.",
  "terminal.read": "Terminal inspection, presentation or lifecycle control is outside the timed write/echo calls and ten-shell RSS sample.", "terminal.search": "Terminal inspection, presentation or lifecycle control is outside the timed write/echo calls and ten-shell RSS sample.",
  "todo.create": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.", "todo.get": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.",
  "todo.listHanded": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.", "todo.getHistory": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.",
  "todo.readHistory": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.", "todo.list": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.",
  "todo.update": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.", "todo.complete": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.",
  "todo.reopen": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.", "todo.setBlockers": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.",
  "todo.assign": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.", "todo.hand": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.",
  "todo.move": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.", "todo.reorder": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.",
  "todo.delete": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.", "todo.deletion": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.",
  "todo.restore": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.", "todo.comment": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.",
  "todo.comments": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.", "todo.unread": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.",
  "todo.markCommentsRead": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.", "todo.addRef": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.",
  "todo.removeRef": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.", "todo.refs": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.",
  "pad.create": "Document editing and storage are outside the Terminal echo and Rail-read workload.", "pad.read": "Document editing and storage are outside the Terminal echo and Rail-read workload.",
  "pad.list": "Document editing and storage are outside the Terminal echo and Rail-read workload.", "pad.rename": "Document editing and storage are outside the Terminal echo and Rail-read workload.",
  "pad.write": "Document editing and storage are outside the Terminal echo and Rail-read workload.", "pad.append": "Document editing and storage are outside the Terminal echo and Rail-read workload.",
  "pad.appendSection": "Document editing and storage are outside the Terminal echo and Rail-read workload.", "pad.setOwner": "Document editing and storage are outside the Terminal echo and Rail-read workload.",
  "pad.move": "Document editing and storage are outside the Terminal echo and Rail-read workload.", "pad.delete": "Document editing and storage are outside the Terminal echo and Rail-read workload.",
  "pad.getDeletion": "Deletion reconciliation is outside the Terminal echo and Rail-read workload.", "pad.restore": "User-requested document restoration is outside the Terminal echo and Rail-read workload.",
  "pad.export": "Document editing and storage are outside the Terminal echo and Rail-read workload.", "pad.setStorage": "Document editing and storage are outside the Terminal echo and Rail-read workload.",
  "agent.spawn": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.", "agent.extras": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.",
  "agent.extras_add": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.", "agent.stop": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.",
  "agent.prompt": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.", "agent.interrupt": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.",
  "agent.worktreeState": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.", "agent.changedFiles": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.",
  "agent.compareFile": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.", "agent.land": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.",
  "agent.discard": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.", "agent.context": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.",
  "agent.brief": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.", "agent.skills": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.",
  "agent.digest": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.", "agent.wake": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.",
  "reaction.create": "Reaction configuration and explicit execution are absent from the isolated Terminal and Rail workload.", "reaction.preview": "Reaction configuration and explicit execution are absent from the isolated Terminal and Rail workload.",
  "reaction.list": "Reaction configuration and explicit execution are absent from the isolated Terminal and Rail workload.", "reaction.get": "Reaction configuration and explicit execution are absent from the isolated Terminal and Rail workload.",
  "reaction.stop": "Reaction configuration and explicit execution are absent from the isolated Terminal and Rail workload.", "reaction.run": "Reaction configuration and explicit execution are absent from the isolated Terminal and Rail workload.",
  "agent.spawnPrompt": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.", "agent.setOrder": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.",
  "agent.instructions": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.", "agent.channelUp": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.",
  "rail.list": "Rail mutation or listing is setup or a user action, outside the repeated rail.tree latency sample.",
  "workstream.setAuto": "Workstream scheduling and lifecycle actions are absent from the steady Rail-read workload.",
  "rail.createWorkstream": "Rail mutation or listing is setup or a user action, outside the repeated rail.tree latency sample.", "rail.move": "Rail mutation or listing is setup or a user action, outside the repeated rail.tree latency sample.",
  "rail.rename": "Rail mutation or listing is setup or a user action, outside the repeated rail.tree latency sample.", "rail.startDoor": "Rail mutation or listing is setup or a user action, outside the repeated rail.tree latency sample.",
  "agent.run": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.",
  "project.setWorktrees": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.", "project.setMcp": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.",
  "project.setPrepared": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.", "project.getPrepared": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.",
  "project.importDiscover": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.",
  "import.list": "Saved-conversation import is explicit user work and absent from the isolated perf workload.",
  "project.importCommit": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.", "project.prepareDirectory": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.",
  "project.get": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.", "project.setModels": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.",
  "models.list": "Vendor model discovery is configuration work, absent from the isolated perf workload.",
  "project.resources": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.", "project.open": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.",
  "project.rename": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload.",
  "attachment.save": "Attachment persistence is absent from the fixed Terminal echo and Rail-read workload.",
  "message.progress": "Durable instruction and result coordination are absent from the Terminal echo and Rail-read workload.", "message.report": "Durable instruction and result coordination are absent from the Terminal echo and Rail-read workload.",
  "message.acceptResult": "Durable instruction and result coordination are absent from the Terminal echo and Rail-read workload.", "message.verifyResult": "Durable instruction and result coordination are absent from the Terminal echo and Rail-read workload.",
  "message.resolveResult": "Durable instruction and result coordination are absent from the Terminal echo and Rail-read workload.", "message.reconcileWork": "Durable instruction and result coordination are absent from the Terminal echo and Rail-read workload.",
  "message.resumeWork": "Durable instruction and result coordination are absent from the Terminal echo and Rail-read workload.", "message.send": "Durable instruction and result coordination are absent from the Terminal echo and Rail-read workload.",
  "message.get": "Durable instruction and result coordination are absent from the Terminal echo and Rail-read workload.", "message.list": "Durable instruction and result coordination are absent from the Terminal echo and Rail-read workload.",
  "message.drop": "Durable instruction and result coordination are absent from the Terminal echo and Rail-read workload.",
  "route.set": "Routing configuration is absent from the isolated Terminal and Rail-read workload.", "route.list": "Routing configuration is absent from the isolated Terminal and Rail-read workload.",
  "checkpoint.write": "Checkpoint persistence and inspection are absent from the fixed perf workload.", "checkpoint.list": "Checkpoint persistence and inspection are absent from the fixed perf workload.",
  "rail.remove": "Rail mutation or listing is setup or a user action, outside the repeated rail.tree latency sample.",
  "rail.deletion": "Deletion reconciliation is outside the Terminal echo and repeated rail.tree latency workload.",
  "rail.restore": "User-requested Rail restoration is outside the Terminal echo and repeated rail.tree latency workload.",
  "agent.resume": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.", "agent.setModel": "Agent lifecycle, configuration and work coordination are outside the timed hook calls; the hook Agent is setup only.",
  "workstream.clear": "Workstream scheduling and lifecycle actions are absent from the steady Rail-read workload.", "workstream.rewindPlan": "Workstream scheduling and lifecycle actions are absent from the steady Rail-read workload.",
  "workstream.rewind": "Workstream scheduling and lifecycle actions are absent from the steady Rail-read workload.", "workstream.handoff": "Workstream scheduling and lifecycle actions are absent from the steady Rail-read workload.",
  "todo.startWorkstream": "Todo management is outside the fixed ten-shell and Rail-read workload; no Todo latency is measured.",
  "workstream.queue": "Workstream scheduling and lifecycle actions are absent from the steady Rail-read workload.", "workstream.dequeue": "Workstream scheduling and lifecycle actions are absent from the steady Rail-read workload.",
  "workstream.queueMove": "Workstream scheduling and lifecycle actions are absent from the steady Rail-read workload.", "workstream.startNow": "Workstream scheduling and lifecycle actions are absent from the steady Rail-read workload.",
  "project.setWorkstreamCap": "Project inspection or configuration is outside the steady Terminal write and Rail-read workload."
}
```

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

The identity evidence in #1266 records a 9V45 Builder at `7922b6f225452fc4da68396d7d75b4ed0054fa74`; it establishes the supported identity, not performance. A 7763 report cannot establish a 9V45 baseline even with identical Ubuntu and CPU counts. An unknown identity, any missing required identity field, or a supported identity without its measured baseline and provenance is an observer error (exit 2), naming the mismatch or missing input. It cannot reuse another class's values or report a clean pass. R16 assigns selection/report metadata to `r16_builder_selects_its_measured_class` and these rejections to `r16_unknown_or_incomplete_linux_class_is_an_observer_error`; these are implementation obligations for all five Builder identities.

The identity evidence in #1303 records an Intel 8573C Builder at `ab349a1d5f46d0dce3c6d51a0a0f8617311c4669` on 2026-10-12: Ubuntu 24.04, x86_64, online CPUs and affinity `0-3`, four available CPUs, kernel `6.17.0-1022-azure`, rustc `1.99.0 (b940084d7 2026-09-28)` and cargo `1.99.0 (5f94df478 2026-08-27)`. This records identity only; AMD measurements establish no Intel baseline.

The identity evidence in #1313 records a 9V74 Builder at `2ae44989f5ec68a2c9021a381f5f2eae8cbb63ff` on 2026-10-12: Ubuntu 24.04 (`ID=ubuntu`, `VERSION_ID=24.04`), x86_64, exact CPU model `AMD EPYC 9V74 80-Core Processor`, online CPUs and affinity `0-3`, four available CPUs, kernel `6.17.0-1022-azure`, rustc `1.99.0 (b940084d7 2026-09-28)`, cargo `1.99.0 (5f94df478 2026-08-27)` and shell `/bin/bash`. This records identity only. No other CPU class can establish its baseline or provenance.

The identity evidence in #1941 records an Intel 8370C Builder at `06fd4eb7e24c476b104e52b94e78fa491d2f47f4`: Ubuntu 24.04.5 (`ID=ubuntu`, `VERSION_ID=24.04`), architecture `x86_64`, exact CPU model `Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz`, online CPUs `0-3`, four available CPUs and process affinity `0-3`. Diagnostic metadata: kernel `6.17.0-1022-azure`, rustc `1.99.0 (b940084d7 2026-09-28)`, cargo `1.99.0 (5f94df478 2026-08-27)` and shell `/bin/bash`. This is identity evidence only; its standalone preflight exit 2 is a qualification failure, not a `just perf` result or latency observation. No Daemon/probe build, timing or benchmark failure is claimed. No other CPU class establishes its baseline or provenance, including Intel 8573C.

#1266, #1303, #1313 and #1941 specify identities only; the Intel specification PR closes #1303 when its specification acceptance holds and the 9V74 specification PR uses `Refs #1313` and closes #1313 only when its specification acceptance holds; the 8370C specification PR uses `Refs #1941` and `Closes #1941` only when its specification acceptance holds. #1366 stays open for same-host Message latency evidence, #1361 for final combined latency acceptance and #1251 for observer implementation, independent calibration and completion observations. Measurement policy: for each newly measured class, including 9V74 and 8370C independently, R16 requires historical/current same-host diagnosis with nine alternating invocations of eleven fresh Daemons per reference, compatible identical probe bytes and isolation of probe changes using the same binaries, nine clean calibration invocations only after regression diagnosis and repair, then three separate clean eleven-Daemon observations on the implementation head with the baseline fixed. Retain every report, per-run metric and load, failed observation and repeat, exit code, reference commit, binary hash and exact command; retain and repeat busy invocations rather than counting them as clean. Diagnose and repair Daemon or probe regressions before accepting a baseline. This identity amendment supplies no evidence that either regression is absent.

### Class selection

`just perf` reads `/etc/os-release`, `lscpu`, `/sys/devices/system/cpu/online`, `/proc/self/status` and the available CPU count (`crates/perf/src/machine.rs`), picks the class whose exact identity matches, and compares only that class's `baseline` entry in `crates/perf/budgets.json`. `crates/perf/classes.json` holds each class's baseline provenance; `target/perf.json` and the printed `class` line carry the key, provenance and machine facts. The boxd class is two online CPUs, affinity `0-1` and an `AMD EPYC` model, so narrowing a Builder's affinity never selects it. An unknown model, a missing field, a class without provenance or without all five Linux baseline metrics (`ping_p95_ms`, `rail_tree_40_p95_ms`, `rss_extra_mb`, `terminal_write_p95_ms`, `write_to_output_p95_ms`) exits 2 naming it. Today only `linux-boxd` is fully measured; `linux-7763` holds Q11's baseline alone, so the Builder classes exit 2 until #3700 records their baselines, each under its own key and provenance. Load thresholds stay keyed by OS (`linux`).

R1–R15 and R8's pins remain unchanged, as do ten login shells, all measured calls, #1366's historical write ceilings and #1361's final combined acceptance. Every class keeps all absolute limits, 10% plus existing noise, Linux's load threshold of 2.0 per CPU, memory comparisons at every load and loud latency skips. A skipped latency comparison cannot complete R16, even on exit 0. No automatic baseline generation, removed metric, widened allowance, baseline increase to hide a regression or CPU-count rescaling is permitted. The implementation pins each class's values, provenance and thresholds in R8's tests; see R16 for test names and the failure/exit table.

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

## Keystroke-to-render in WKWebView

> **This opens a window over your screen and types into it.** The window is always on top and on every Space for about 40 s per run (three runs by default), and it never takes the keyboard focus on purpose, but it covers whatever you are doing. `just perf-keystroke` and `perf-keystroke` refuse unless `ROUNDUP_ALLOW_WINDOW=1` is set, and it is set only by someone the user asked to run it (R12). No agent, Reviewer, CI job, boxd VM or `just check` runs it.

What the number proves: keydown to the first xterm render that shows the echo, in the real WKWebView on macOS, with the renderer and mean frame time recorded. What it does not: it is not a CI gate and not a Linux number, it excludes the keyboard, OS event path and display scan-out, `performance.now()` is a 1 ms bound, and p95 in whole milliseconds makes a 10% test move in 1 ms steps, so its budget is the 16 ms limit only. The cheap headless bound is the Daemon-side `write_to_output_p95_ms` limit of 16 ms in `just perf` (R8).

`just perf-keystroke` (macOS only) builds the App with the keystroke probe (`VITE_ROUNDUP_PERF`, K1) into `target/perf-app`, opens its window once per run, lets the webview type 1000 keys into a raw `cat` Terminal and reads the result back (K3, R11). The report carries the renderer (`webgl` or `dom`) and the mean frame time.

R21 judges each run separately: p95 must be strictly below 16 ms, with zero
dropped keys, including the 100 warm-up keys. Warm-up latency samples remain
excluded. `target/perf-keystroke.json` retains the complete `reports` array and
per-run `loads`, including failures, and is updated after each run. A latency
or drop miss exits 1; an invalid observation exits 2. The runner uses temporary
App, webview and Daemon data even when the caller has data overrides. Its
Workstream uses the fake vendor executable, never the user's real `claude`.

What can go wrong:
- **A covered or napped window stops drawing.** macOS stops rAF and timers for a window other windows cover and naps an App that is not frontmost: measured here, with the window behind a full-screen Chrome, rendering stopped entirely and every key timed out. The perf build's window is therefore always on top and on every Space (a `TAURI_CONFIG` override in the recipe, so normal builds are unchanged), and the runner passes `-NSAppSleepDisabled YES`. The window stays over whatever you are doing for about 40 s per run, three runs. A mean frame time above 25 ms exits 2; its report is retained. Any dropped key fails under R21.
- **Low Power Mode.** It halves the webview's frame rate, so a run in it measures the power setting, not the App; run on AC power with Low Power Mode off.
- **Load.** Run it with the laptop idle; the load average is printed per run.
- **Windows over a headless Chromium number.** Chromium with the same xterm measured p95 under 5 ms; WKWebView on an M4 Max in the earlier spike measured 11 to 15 ms. The difference is the frame wait, so the budget is only meaningful here.

### R20 observations retained from #3550

These are the work order's observations, before the repair, on AC power on a
16-core Mac. The raw reports, OS/app versions, power-mode confirmation and
per-hop attribution were not supplied. They cannot establish the dominant hop
or replace R20's quiet-machine observations. No after-repair performance is
claimed by the observer-safety changes.

| Method / workload | roundup p50 / p95 (ms) | Solo p50 / p95 (ms) | Samples / load |
| --- | --- | --- | --- |
| WKWebView, raw `cat` | 30 / 35 | — | 1000 keys × 3; 13–25 drops/run; load 6–9 |
| Daemon `write_to_output` | — / 20.8 | — | `just perf`; load 6–9 |
| Outside key-to-pixel, idle zsh | 36 / 45 | — | 60 samples × 2; load 6–9 |
| Outside, idle zsh comparison | 40 / 50 | 39 / 48 | one run set; load ~7 |
| Outside, real `claude`, no Enter | 39–41 / 48 | 39.5 / 49–53 | one run set; load ~7 |
| Outside, typing beside `yes` | 101–106 / 129–136 | 33 / 38.5 | load 5.5–6.8 |
| Outside, switch two Terminals | 70–71 / 80–81 | 75 / 81–82 | load 5.5–6.8 |
| Outside, scroll 10k lines | 20–23 / 26–29 | 26–28 / 37 | load 5.5–6.8 |

The flooding observation had 100–120% CPU each in the webview, Daemon and host
App, versus about 30% for Solo's flooding Terminal. The proposed hidden-screen
explanation remains unproven. The native observations below use
`ROUNDUP_ALLOW_WINDOW=1 just perf-keystroke --out target/perf-keystroke-before.json`.
The [retained reports](perf-keystroke-mac-observations.json) include the owner's
complete comments, console output, source links and JSON, including the failures.


The recorder repairs in #3694 and #3717 merged before a further native run at
`01dacd91ce7b1e5ffd874202df4ada323e114d5c`. The command above exited 2: all
three reports contained `{"probe":"roundup-keystroke-probe","error":"no key was echoed and rendered after the warm-up"}`.
The machine was an M4 Max MacBook Pro, 16 CPUs, macOS 26.0.1, AC power at
100% charge, Low Power Mode off, unlocked, with the owner not touching the
window. Per-run 1-minute loads were 10.69091796875, 2.76953125 and
2.396484375 (0.67, 0.17 and 0.15 per CPU); the first run was busy after the
release build. There are no latency, renderer, frame-time or timer-resolution
measurements from these failed runs. Full console output and the saved report
remain on [#3550](https://github.com/saadshahd/roundup/issues/3550).

#3748 binds typing to the Terminal that printed `ready`, which already owns
report delivery. The old document-wide lookup could select an Agent's earlier
xterm textarea. A no-window regression test demonstrates that case with two
inputs and asserts that only the ready shell receives the key. The owner's
repeat at `7ce598e5a` still failed all three runs with the same warm-up error
(exit 2; [comment](https://github.com/saadshahd/roundup/issues/3550#issuecomment-6387912547)).

### Successful idle observation on #3755 (2026-10-24)

At `853f9440b8269b943dab07c9fa1dae79d060a204`, based on `59cff55ca`, the
owner ran the command above on an M4 Max MacBook Pro, 16 CPUs, macOS 26.0.1,
AC power, Low Power Mode off. Exit: 0. Each run reports 1000 measured keys,
zero drops, WebGL, 1 ms timer resolution and device pixel ratio 2.

| Run | 1-minute load / per CPU | p50 / p95 / p99 (ms) | Mean frame (ms) |
| --- | --- | --- | --- |
| 1 | 5.7705 / 0.361 | 6 / 10 / 12 | 8.3220 |
| 2 | 4.4482 / 0.278 | 6 / 10 / 11 | 8.3559 |
| 3 | 3.0508 / 0.191 | 6 / 10 / 15 | 8.3390 |

All three are below R20's 0.45 load-per-CPU threshold. The owner identified
an observer failure: the Workstream's Agent Terminal appeared about 200 ms
after `ready`, took focus and folded the shell bubble. xterm's
IntersectionObserver then paused rendering; echoes were parsed but never
rendered. #3755 waits for that Agent Terminal before opening the shell Terminal.
This repairs the recorder's visibility, not a measured production latency hop.
The successful reports came from that open PR; they do not establish results
for an unmodified `main` build.

The largest reported hop is `parsed_to_frame`, p50 4 ms and p95 7 ms in all
three runs. `dispatch_to_echo_event` is next, p50 2 / 1 / 2 ms and p95
3 / 3 / 4 ms. `write_reply` overlaps that chain (p95 4 ms in each run).
The reported uncertainty is 1 ms timer resolution, not cross-clock calibration.
These coarse webview spans cannot identify the largest of all R20's required
hops: base64, Daemon receipt, PTY write and echo read remain unsplit.

#3550 stays open. Missing acceptance includes full R20 attribution and calibrated
uncertainty, reproducible quiet-Mac Solo comparisons, a measured production
repair with before/after distributions, the shared Agent/shell input-path test,
and three passing runs while another Terminal floods output. The three idle
runs above meet the numerical idle budget only. No further Mac timing is
requested by this evidence update.


## X14 retained flood observation

`just perf --flood --out target/perf-flood.json` builds the release probe and runs
only the isolated real-Daemon flood observer. Ordinary `just perf` retains every
idle metric, budget, load/skip rule and qualification requirement above; flood
mode is a separate correctness observation, not latency or R16 qualification.
It opens no native window and supplies no R11/R12 keystroke evidence.

```text
real temporary Daemon → ten gated shells → exec yes
                      → independent RPC output drain → chunks per Terminal > Bus capacity
paused actual Bus receiver → two identified Rail markers → resume after producer shutdown
report → counters + received markers + payloads + structured lag + cleanup + outcome
```

The two Rail markers are emitted while the actual receiver is unread, before
releasing the ten programs; their count is strictly below the Daemon's reported
Bus capacity. Output is drained through the existing RPC client independently
of that receiver. Collection stops only after every Terminal exceeds capacity;
producers then stop before resuming the receiver to obtain a finite observation.
The report retains partial counters on failure, both marker identity lists,
Terminal payload count, lag error and missed-event counts, and verified stopped
Terminal count. Missing or incomplete counters and markers cannot pass.
`--flood-timeout 60` bounds startup/collection; shutdown and shutdown verification
have separate ten-second bounds. Only this temporary Project's processes and
socket/data are touched.

| Executable exit | Meaning |
| --- | --- |
| 0 | Complete counters, all markers in order, no payloads or lag, successful cleanup |
| 1 | Complete observation violates isolation or loses markers (expected on current transport) |
| 2 | Startup, collection timeout/error, cleanup or report-write failure; no valid acceptance |

A failing command through `just` may return the recipe's exit 1; the executable's
exit and JSON `flood.error` distinguish an observation error from detected lag.
Keep the JSON and command/exit with source and probe binary hashes, host,
toolchain, profile and load when recording an observation. Do not replace or
relax `budgets.json`. #1930 must migrate this output drain to selected streams
in its Contract PR, rerun this command and retain zero Rail lag; this observer
does not complete #1930 or X14's Terminal regression/journey acceptance.

### R20 hop attribution

[Recorder attribution](perf-keystroke-attribution.md) describes the correlated
Daemon stamps, echo identity, calibration bounds, retained hops and window-free
proofs. The native observations above are unchanged; #3550 still owns full-chain
native evidence and the production repair.

The [2026-10-25 full-chain attempt](https://github.com/roundup-app/roundup/issues/3550#issuecomment-6396746360)
at `477a3ce93f937cb734b4a69d6a0cb710ebfd3293` exited 2: all three quiet-Mac
runs timed out collecting a complete PERF line. Its complete report and console
output are retained in [the observations](perf-keystroke-mac-observations.json).
No hop timings or latency verdict can be derived from it.

Keystroke runs now retain a separate `perf-keystroke-*` diagnostics directory
beside `--out` for every run, listed in the saved report's `diagnostics` array.
It holds App stdout/stderr, Daemon stderr, collection phase and raw Terminal
output, and lifecycle/cleanup results; a failed launch still keeps its logs.
Temporary App data is still removed. A setup failure before a ready Bubble
opens a Project-owned diagnostic shell, waits for its raw-tty ready line, and
prints the original named setup error through it. This shell starts no Agent.
Failure to open or ready that shell still exits 2 with collector diagnostics.
Successful measurements continue to report through their measured shell.
These are recorder repairs; #3550 remains open for full-chain observations,
the measured production repair, shared Agent/shell input proof and idle/flood acceptance.

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
