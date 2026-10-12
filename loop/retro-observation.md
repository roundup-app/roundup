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

## Pending observation

The first run is collecting input. Its fixed window must be read from the
`retro-input` artifact, not inferred from its workflow creation time. No report,
repair, predecessor or repeat-publication result is claimed here.

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
