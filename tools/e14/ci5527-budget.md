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
