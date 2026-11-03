# CI5527 web budget observation

Work order: [#5666](https://github.com/roundup-app/roundup/issues/5666).
Scenarios: CI5527b, CI5527c (`scenarios/ci-web-budget.md`).

Implementation [#5904](https://github.com/roundup-app/roundup/pull/5904), continuing
[#5871](https://github.com/roundup-app/roundup/pull/5871), merged at
2026-11-03T15:44:14Z as `5e17263fe6109206a6545740e2e03f48c70b20e2`.
This report observes that implementation; it changes no test selection, runner,
shard count, concurrency, retry, timeout or budget.

## Guard observation (CI5527c)

On checkout `ada406b500d9fa415e7777d201ad6f6130f9f946`, run:

```sh
python3 tools/e14/observe.test.py CI5527 -v
```

All five fixture tests pass. They cover both full and affected selections,
below/at/above 720 seconds, already-failed commands, setup/report work crossing
the boundary, six unordered file durations, ties, fewer than five files, and
missing/malformed evidence. The production command and monotonic clock seams
are exercised without sleeping or rerunning tests.

Controlled failing invocation:

```sh
python3 - <<'PY'
import importlib.util
from pathlib import Path
import sys
spec = importlib.util.spec_from_file_location('fixtures', Path('tools/e14/observe.test.py'))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
files = [('z', 12), ('e', 50), ('a', 80), ('c', 50), ('b', 70), ('d', 30)]
modules = [dict(id=name, state='passed', duration_ms=duration,
                tests=[dict(id=name, status='passed', retries=0, repeats=0,
                            start=1500, end=1500, real=False)]) for name, duration in files]
code, diagnostic = fixtures.CI5527().invoke(720.001, modules=modules, base='')
print(diagnostic, end='')
print(f'Controlled production guard exit: {code}')
sys.exit(code)
PY
```

After the full-selection fixture metadata, the final diagnostic is:

```text
web2: 720.001 seconds exceeds 720-second budget; slowest files:
  a: 80 ms
  b: 70 ms
  c: 50 ms
  e: 50 ms
  d: 30 ms
Controlled production guard exit: 1
```

Shell exit: **1**. Supplied fixture times are guard evidence only, never a
CI5527b performance observation.

## Full main observation (CI5527b)

The first full main run after the implementation merge is
[41666975963](https://github.com/roundup-app/roundup/actions/runs/41666975963),
a push run created at 2026-11-03T15:44:18Z. Its seven web steps passed the
720-second guard. **CI5527b fails:** five full step intervals exceed its separate,
strictly-below-600-second target. Keep #5666 open and repair forward.

These are Actions `test-web` step timestamps, including preparation, execution
and reporting, not whole-job or observer child-command intervals.

| Shard / job | Commit | Start (UTC) | Finish (UTC) | Seconds | Conclusion / CI5527b |
| --- | --- | --- | --- | ---: | --- |
| [web 1](https://github.com/roundup-app/roundup/actions/runs/41666975963/job/126025100821) | `5e17263fe6109206a6545740e2e03f48c70b20e2` | 2026-11-03T15:50:25Z | 2026-11-03T16:01:46Z | 681 | success; FAIL <600s |
| [web 2](https://github.com/roundup-app/roundup/actions/runs/41666975963/job/126025100668) | `5e17263fe6109206a6545740e2e03f48c70b20e2` | 2026-11-03T15:50:59Z | 2026-11-03T16:02:16Z | 677 | success; FAIL <600s |
| [web 3](https://github.com/roundup-app/roundup/actions/runs/41666975963/job/126025100860) | `5e17263fe6109206a6545740e2e03f48c70b20e2` | 2026-11-03T15:51:00Z | 2026-11-03T16:00:46Z | 586 | success; pass <600s |
| [web 4](https://github.com/roundup-app/roundup/actions/runs/41666975963/job/126025100863) | `5e17263fe6109206a6545740e2e03f48c70b20e2` | 2026-11-03T15:50:22Z | 2026-11-03T15:59:37Z | 555 | success; pass <600s |
| [web 5](https://github.com/roundup-app/roundup/actions/runs/41666975963/job/126025100813) | `5e17263fe6109206a6545740e2e03f48c70b20e2` | 2026-11-03T15:50:34Z | 2026-11-03T16:02:24Z | 710 | success; FAIL <600s |
| [web 6](https://github.com/roundup-app/roundup/actions/runs/41666975963/job/126025100835) | `5e17263fe6109206a6545740e2e03f48c70b20e2` | 2026-11-03T15:50:38Z | 2026-11-03T16:01:24Z | 646 | success; FAIL <600s |
| [web 7](https://github.com/roundup-app/roundup/actions/runs/41666975963/job/126025100760) | `5e17263fe6109206a6545740e2e03f48c70b20e2` | 2026-11-03T15:50:30Z | 2026-11-03T16:01:53Z | 683 | success; FAIL <600s |

All seven downloaded `e14-web<N>-1` artifacts have `lane.json` with
`full: true`, `exit_code: 0`, and the merge commit above. Their commands include
`test-web-since` with an empty base and their respective `--shard=<N>/7`.
The run retains the hook-inclusive `web.json` reports and step logs.

The completed run's aggregate `check` failed after its Mac job was cancelled.
It therefore cannot satisfy the first-green-full-run requirement. The seven
successful web-step intervals above remain evidence of the missed target,
even if a later run succeeds.

## Evidence PR check failure

On PR #5909 head `29c8e87231a584492f8a1fd9b1b06a90f77a0eb7`,
[lint job 126038438623](https://github.com/roundup-app/roundup/actions/runs/41670836334/job/126038438623)
was cancelled during `git fetch --no-tags --depth=200 origin
+refs/heads/main:refs/remotes/origin/main`. The step started at
2026-11-03T16:07:17Z and ended at 2026-11-03T16:22:22Z with
`The operation was canceled.` Setup and lint execution were skipped; `pre`
then failed because its lint dependency was cancelled. This run supplies no
lint result or new performance observation. Preserve the required gates and
retry CI on the updated evidence head.

On head `0ad8ed50b1e40e94e16e1449bdc0ac438f1888f2`,
[lint job 126055465918](https://github.com/roundup-app/roundup/actions/runs/41675662819/job/126055465918)
hit its 15-minute job limit (check annotation: `The job has exceeded the
maximum execution time of 15m0s`). The main-branch fetch ran from
2026-11-03T16:35:05Z to 16:44:57Z (592 seconds); setup finished at
16:46:38Z. Unlike the earlier attempt, lint execution started, but was
cancelled at 16:50:17Z. The log reports no lint failure before cancellation;
it supplies no completed lint pass. `pre` failed on the cancelled dependency.
The same main-branch fetch completed locally in under one second during
investigation; no persistent fetch failure was reproduced. Retry on the
updated evidence head, retaining the job limit and every required gate.

On head `c8bc3c971ecba36c75a55b84468c0ffdb3fb70ad`,
[lint job 126073056181](https://github.com/roundup-app/roundup/actions/runs/41680418298/job/126073056181)
again exhausted the job limit during the main-branch fetch. The fetch started
at 2026-11-03T17:05:20.5398429Z and was cancelled at
17:19:59.8891368Z (879.349 seconds). Setup and lint execution were skipped;
`pre` failed because lint was cancelled. This supplies no lint result or
performance observation. Local fetching completed successfully, but does not
establish why the hosted fetch stalled. Merge current main and retry the
required CI gates; no timeout, workflow or gate is changed.

## Repair prerequisite

[#5911](https://github.com/roundup-app/roundup/issues/5911) blocks #5666 and scopes
four remaining unbatched teardown hooks found in these reports. It requires
unchanged behavior, explicit observer runs, required lints and CI evidence of
improvement. This report makes no claim that batching alone will bring every
shard below 600 seconds. After repairs merge, observe the full main run again;
retain this failed performance observation and all intervening failures.

| Current executed file | Shard | Hook-inclusive ms | Existing teardown |
| --- | --- | ---: | --- |
| `src/todos/u3751_triage.test.tsx` | web6 | 53850.913992999995 | `afterEach(cleanup)` |
| `src/testing/u159_workstream_todos.test.tsx` | web6 | 43612.653556 | `afterEach(cleanup)` |
| `src/todos/u3708_nesting.test.tsx` | web1 | 29304.937266000004 | `afterEach(cleanup)` |
| `src/bubbles/u4274_navigation.test.tsx` | web2 | 53651.094965000004 | `cleanup()` before storage clearing |

The raw durations identify repair candidates, not a measured improvement.
No local observer duration is CI5527b evidence.

Repair [#5912](https://github.com/roundup-app/roundup/pull/5912) subsequently
merged as `0cfb3fdee8b0c3bbcb72497246992c49578b7d4b`, closing #5911.
The full main checks for that merge and the next main head were still running
when this evidence was updated; no replacement performance result is claimed.


## Continued observation after #5909

Continue closed-unmerged [#5909](https://github.com/roundup-app/roundup/pull/5909)
without discarding the observations above. The implementation is already on main.
[#5921](https://github.com/roundup-app/roundup/pull/5921) merged at
2026-11-03T17:40:42Z as `80e543464d7c01eedeff7f864bd0933adaa18cda`.
It sends the budget diagnostic to flushed stderr and the Actions summary and
refreshes existing shard weights. No duplicate implementation is needed.

The following intervals come from Actions `test-web` steps. All conclusions
below are step conclusions; a successful step of 600 seconds or more fails
CI5527b. Failed runs remain evidence, rather than being replaced by later samples.

### First green full run after #5904

Run [41667542025](https://github.com/roundup-app/roundup/actions/runs/41667542025), commit `ada406b500d9fa415e7777d201ad6f6130f9f946`.

| Shard / job | Start (UTC) | Finish (UTC) | Seconds | Conclusion / CI5527b |
| --- | --- | --- | ---: | --- |
| [web 1](https://github.com/roundup-app/roundup/actions/runs/41667542025/job/126027270212) | 2026-11-03T15:53:21Z | 2026-11-03T16:05:00Z | 699 | success; FAIL |
| [web 2](https://github.com/roundup-app/roundup/actions/runs/41667542025/job/126027270140) | 2026-11-03T15:53:33Z | 2026-11-03T16:00:36Z | 423 | success; pass <600s |
| [web 3](https://github.com/roundup-app/roundup/actions/runs/41667542025/job/126027270428) | 2026-11-03T15:53:03Z | 2026-11-03T16:01:24Z | 501 | success; pass <600s |
| [web 4](https://github.com/roundup-app/roundup/actions/runs/41667542025/job/126027270412) | 2026-11-03T15:56:43Z | 2026-11-03T16:04:56Z | 493 | success; pass <600s |
| [web 5](https://github.com/roundup-app/roundup/actions/runs/41667542025/job/126027270249) | 2026-11-03T15:54:34Z | 2026-11-03T16:03:49Z | 555 | success; pass <600s |
| [web 6](https://github.com/roundup-app/roundup/actions/runs/41667542025/job/126027270191) | 2026-11-03T15:52:41Z | 2026-11-03T16:00:52Z | 491 | success; pass <600s |
| [web 7](https://github.com/roundup-app/roundup/actions/runs/41667542025/job/126027270096) | 2026-11-03T15:54:31Z | 2026-11-03T16:04:16Z | 585 | success; pass <600s |

### Retained failure: missing budget diagnostic

Run [41671191057](https://github.com/roundup-app/roundup/actions/runs/41671191057), commit `816eef1301df1163e7468aef6029a585c335f4f8`.

| Shard / job | Start (UTC) | Finish (UTC) | Seconds | Conclusion / CI5527b |
| --- | --- | --- | ---: | --- |
| [web 1](https://github.com/roundup-app/roundup/actions/runs/41671191057/job/126039831930) | 2026-11-03T16:14:48Z | 2026-11-03T16:25:33Z | 645 | success; FAIL |
| [web 2](https://github.com/roundup-app/roundup/actions/runs/41671191057/job/126039832074) | 2026-11-03T16:15:31Z | 2026-11-03T16:24:11Z | 520 | success; pass <600s |
| [web 3](https://github.com/roundup-app/roundup/actions/runs/41671191057/job/126039832046) | 2026-11-03T16:14:44Z | 2026-11-03T16:23:58Z | 554 | success; pass <600s |
| [web 4](https://github.com/roundup-app/roundup/actions/runs/41671191057/job/126039832134) | 2026-11-03T16:15:46Z | 2026-11-03T16:26:19Z | 633 | success; FAIL |
| [web 5](https://github.com/roundup-app/roundup/actions/runs/41671191057/job/126039832125) | 2026-11-03T16:15:51Z | 2026-11-03T16:28:11Z | 740 | failure; FAIL |
| [web 6](https://github.com/roundup-app/roundup/actions/runs/41671191057/job/126039832041) | 2026-11-03T16:14:47Z | 2026-11-03T16:25:08Z | 621 | success; FAIL |
| [web 7](https://github.com/roundup-app/roundup/actions/runs/41671191057/job/126039832082) | 2026-11-03T16:15:10Z | 2026-11-03T16:24:57Z | 587 | success; pass <600s |

### Retained later failure

Run [41674004951](https://github.com/roundup-app/roundup/actions/runs/41674004951), commit `59f67922447ce40b2a76492611117ad44da28578`.

| Shard / job | Start (UTC) | Finish (UTC) | Seconds | Conclusion / CI5527b |
| --- | --- | --- | ---: | --- |
| [web 1](https://github.com/roundup-app/roundup/actions/runs/41674004951/job/126049833287) | 2026-11-03T16:37:01Z | 2026-11-03T16:49:20Z | 739 | failure; FAIL |
| [web 2](https://github.com/roundup-app/roundup/actions/runs/41674004951/job/126049833155) | 2026-11-03T16:30:07Z | 2026-11-03T16:40:22Z | 615 | success; FAIL |
| [web 3](https://github.com/roundup-app/roundup/actions/runs/41674004951/job/126049833104) | 2026-11-03T16:30:52Z | 2026-11-03T16:39:22Z | 510 | success; pass <600s |
| [web 4](https://github.com/roundup-app/roundup/actions/runs/41674004951/job/126049832913) | 2026-11-03T16:31:25Z | 2026-11-03T16:41:04Z | 579 | success; pass <600s |
| [web 5](https://github.com/roundup-app/roundup/actions/runs/41674004951/job/126049832996) | 2026-11-03T16:30:30Z | 2026-11-03T16:42:26Z | 716 | success; FAIL |
| [web 6](https://github.com/roundup-app/roundup/actions/runs/41674004951/job/126049832848) | 2026-11-03T16:31:06Z | 2026-11-03T16:39:36Z | 510 | success; pass <600s |
| [web 7](https://github.com/roundup-app/roundup/actions/runs/41674004951/job/126049832908) | 2026-11-03T16:31:53Z | 2026-11-03T16:42:18Z | 625 | success; FAIL |

### Retained later failure

Run [41677514433](https://github.com/roundup-app/roundup/actions/runs/41677514433), commit `28058cc1726b7fdcf9412b1c48cd5cdd5dcf900a`.

| Shard / job | Start (UTC) | Finish (UTC) | Seconds | Conclusion / CI5527b |
| --- | --- | --- | ---: | --- |
| [web 1](https://github.com/roundup-app/roundup/actions/runs/41677514433/job/126062413914) | 2026-11-03T16:52:38Z | 2026-11-03T17:05:03Z | 745 | failure; FAIL |
| [web 2](https://github.com/roundup-app/roundup/actions/runs/41677514433/job/126062414240) | 2026-11-03T16:51:29Z | 2026-11-03T17:02:59Z | 690 | success; FAIL |
| [web 3](https://github.com/roundup-app/roundup/actions/runs/41677514433/job/126062413864) | 2026-11-03T16:52:27Z | 2026-11-03T17:02:59Z | 632 | success; FAIL |
| [web 4](https://github.com/roundup-app/roundup/actions/runs/41677514433/job/126062414005) | 2026-11-03T16:51:28Z | 2026-11-03T17:00:18Z | 530 | success; pass <600s |
| [web 5](https://github.com/roundup-app/roundup/actions/runs/41677514433/job/126062414316) | 2026-11-03T16:53:03Z | 2026-11-03T17:05:46Z | 763 | failure; FAIL |
| [web 6](https://github.com/roundup-app/roundup/actions/runs/41677514433/job/126062413893) | 2026-11-03T16:52:49Z | 2026-11-03T17:00:41Z | 472 | success; pass <600s |
| [web 7](https://github.com/roundup-app/roundup/actions/runs/41677514433/job/126062414214) | 2026-11-03T16:51:47Z | 2026-11-03T17:02:59Z | 672 | success; FAIL |

### First green full run after #5921

Run [41686557916](https://github.com/roundup-app/roundup/actions/runs/41686557916), commit `80e543464d7c01eedeff7f864bd0933adaa18cda`.

| Shard / job | Start (UTC) | Finish (UTC) | Seconds | Conclusion / CI5527b |
| --- | --- | --- | ---: | --- |
| [web 1](https://github.com/roundup-app/roundup/actions/runs/41686557916/job/126094165360) | 2026-11-03T17:47:25Z | 2026-11-03T17:58:14Z | 649 | success; FAIL |
| [web 2](https://github.com/roundup-app/roundup/actions/runs/41686557916/job/126094165565) | 2026-11-03T17:47:50Z | 2026-11-03T17:58:02Z | 612 | success; FAIL |
| [web 3](https://github.com/roundup-app/roundup/actions/runs/41686557916/job/126094165346) | 2026-11-03T17:46:43Z | 2026-11-03T17:54:32Z | 469 | success; pass <600s |
| [web 4](https://github.com/roundup-app/roundup/actions/runs/41686557916/job/126094165318) | 2026-11-03T17:46:25Z | 2026-11-03T17:55:39Z | 554 | success; pass <600s |
| [web 5](https://github.com/roundup-app/roundup/actions/runs/41686557916/job/126094165373) | 2026-11-03T17:47:56Z | 2026-11-03T17:57:31Z | 575 | success; pass <600s |
| [web 6](https://github.com/roundup-app/roundup/actions/runs/41686557916/job/126094165337) | 2026-11-03T17:46:26Z | 2026-11-03T17:57:22Z | 656 | success; FAIL |
| [web 7](https://github.com/roundup-app/roundup/actions/runs/41686557916/job/126094165578) | 2026-11-03T17:48:13Z | 2026-11-03T17:57:53Z | 580 | success; pass <600s |

The seven `e14-web<N>-1` artifacts for both first-green runs were downloaded
and inspected: each `lane.json` names the run's commit, `full: true`,
`exit_code: 0`, an empty `test-web-since` base and its `--shard=<N>/7`;
each contains the existing hook-inclusive `web.json` report. The Actions artifact
archives remain the source reports. No affected run or child-command interval
is substituted for these step times.

On this continuation, `python3 tools/e14/observe.test.py CI5527 -v` passes
all six current fixtures, including the job-summary diagnostic check added by
#5921. Repeating the controlled invocation printed above exits **1** and prints
exactly the same five-file diagnostic. Supplied fixture timing is not a full-run
performance claim. CI5527b remains unmet, so #5666 stays open for repair forward.
