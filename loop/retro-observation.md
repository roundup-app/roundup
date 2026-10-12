# L106 live observation

Dispatch path → first publication → preserved snapshot → same-date repeat → independent counts.

This is partial evidence for #1308 and #1265, not completed L106 acceptance.

## Authorized dispatch

[PR #1311](https://github.com/saadshahd/roundup/pull/1311) merged as
`1a9101460cabc8f34d40cd0065ccad5b7f112652` after independent review and the required gates.
[Observer job 115010157344](https://github.com/saadshahd/roundup/actions/runs/38309085849/job/115010157344)
successfully dispatched [Retro run 38309102644](https://github.com/saadshahd/roundup/actions/runs/38309102644)
on `main` at 2026-10-12T21:11:54Z.

The observer job's setup log lists Actions write, Contents read and Issues write.
Its checkout uses `persist-credentials: false`. The dispatch ledger on
[work Issue #1308](https://github.com/saadshahd/roundup/issues/1308) records intent
at `2026-10-12T21:11:52+00:00`, with no earlier workflow-dispatch runs.
The successful dispatch replaces the earlier Builder-token HTTP 403; no Builder
App permission was expanded. Retro retains Actions/Contents/pull-request reads
and Issue writes, and does not receive the observer's Actions write credential.

## Failed first observation

The first run failed in `Collect fixed-window input` at 2026-10-12T21:22:36Z.
The failed log names an Actions request for the split interval
`2026-10-12T19:42:03Z..2026-10-12T21:12:03Z` that exited nonzero. The log does
not expose GitHub's error response, so its cause is unknown. No input artifact,
report or repair was published. The implied 24-hour window is
`[2026-10-11T21:12:03Z, 2026-10-12T21:12:03Z)`, inferred from the split request;
there is no completed input artifact with which to validate it.

The dispatch path succeeded, but this run does not prove publication or any
metric. The observer correctly requires a successful first publication before
repeating. Its failed intent must remain evidence and must not be silently
redispatched. A collector repair and an explicit recovery of the failed
observation are prerequisites for completing #1308. Collector repair is tracked
by [#1315](https://github.com/saadshahd/roundup/issues/1315), which blocks #1308.

After publication, the serialized observer preserves the input, report and Issue
snapshots in its `l106-observer` artifact before dispatching the repeat. Both
completed run URLs, exact windows and report/repair links belong on #1265.
Acceptance still requires independent GitHub source counts for every script
metric, queue statistic and model count; explicit unknown evidence; same-date
report reuse; predecessor closure when present; no more than three daily new
repairs across both runs; and semantic review against duplicate open loop repairs.

## Regression checks

On the merged dispatch implementation, `python3 loop/retro.test.py` passed 43
tests, `python3 loop/retro-observer.test.py` passed eight, and
`python3 loop/workflows.test.py` passed all 84 tests. These cover the authorized
dispatch path, snapshots before repeat, report reuse and the retained Builder
Actions-read and Retro role limits. Fixture results do not replace the pending
live observation.
