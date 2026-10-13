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

## 2026-10-13 source reconciliation and recovery

Report [#1525](https://github.com/saadshahd/roundup/issues/1525) was published by
[run 38457744271](https://github.com/saadshahd/roundup/actions/runs/38457744271).
Its `retro-input` artifact fixes `[2026-10-12T19:48:27Z, 2026-10-13T19:48:27Z)`.
This owner-dispatched run is not a completed pair from the authorized observer.

The input counts nine distinct closed-unmerged PRs: 1463, 1461, 1459, 1453,
1413, 1408, 1372, 1317 and 1283. GitHub's search
`repo:saadshahd/roundup is:pr is:closed is:unmerged closed:2026-10-12T19:48:27Z..2026-10-13T19:48:27Z`
returns six: 1453, 1413, 1408, 1372, 1317 and 1283.
The same search using `closed:2026-10-13` also returns six.

Independent direct PR reads and closing-event reads confirm the missing three:

| PR | Direct `closed_at` (UTC) | Direct closing event | `merged_at` |
|---|---|---|---|
| [#1463](https://github.com/saadshahd/roundup/pull/1463) | 2026-10-13T11:21:57Z | [33127286137](https://api.github.com/repos/saadshahd/roundup/issues/events/33127286137), 11:21:57Z | null |
| [#1461](https://github.com/saadshahd/roundup/pull/1461) | 2026-10-13T12:12:58Z | [33130948207](https://api.github.com/repos/saadshahd/roundup/issues/events/33130948207), 12:12:58Z | null |
| [#1459](https://github.com/saadshahd/roundup/pull/1459) | 2026-10-13T12:13:00Z | [33130951334](https://api.github.com/repos/saadshahd/roundup/issues/events/33130951334), 12:13:01Z | null |

The other six were also read independently from both endpoints:

| PR | Direct `closed_at` (UTC) | Closing event time (UTC) |
|---|---|---|
| #1453 | 2026-10-13T15:13:36Z | 15:13:36Z |
| #1413 | 2026-10-13T15:02:31Z | 15:02:31Z |
| #1408 | 2026-10-13T06:10:38Z | 06:10:39Z |
| #1372 | 2026-10-13T06:11:18Z | 06:11:18Z |
| #1317 | 2026-10-13T11:22:02Z | 11:22:02Z |
| #1283 | 2026-10-13T15:39:06Z | 15:39:06Z |

Each has null `merged_at` and a closing event inside the window.
All three search omissions' direct PRs are closed. Search by each PR number returns these same
closed timestamps and null merge timestamps, while the closed-date query
omits them. Nine is the evidenced count; reducing Retro to six would discard
three real closures. Why GitHub's search qualifiers omit them is unknown.
Reproduce with `gh api repos/saadshahd/roundup/pulls/<number>` and
`gh api repos/saadshahd/roundup/issues/<number>/events --paginate`.
The missing cause comments remain `unknown`; owner closure alone is not a
recorded cause. This reconciliation does not validate the other report metrics.

The old ledger's request is `2026-10-12T21:11:52+00:00`.
Run 38309102644 was created at 21:11:54Z by `github-actions[bot]`.
The dispatch job ended at 21:11:56Z. Eight later dispatches were created hours
later, first at 2026-10-13T00:29:53Z; they are not deliveries of this intent.

Recovery admits a unique Actions-authored delivery within five minutes of
intent and persists its run ID before reading completion. Missing, late or
multiple candidates remain unknown and cannot trigger a retry. Subsequent
reads use that ID, so later diagnostic runs do not change its identity.
The workflow explicitly authorizes recovery of terminal failed run 38309102644
only. It appends that intent, URL, ID and failure to `failed_dispatches`, then
starts a fresh pair on a later tick. A new failure retains the existing stop;
there is no general automatic failed-dispatch retry. Issue closure still stops
observation, and the first successful snapshot still precedes the repeat.

Pending after independent merge: two successful workflow-authorized dispatches,
all metric and unknown counts from their linked sources, same-date report reuse,
predecessor closure, daily allowance and semantic duplicate-repair review.
Neither #1308 nor #1265 is complete on this record.

A read-only preview against the live #1308 ledger and Actions API selected
38309102644, then produced `dispatches: []` with the original intent retained
under `failed_dispatches` and `conclusion: failure`. Its write boundary was
replaced with stdout; the preview made no GitHub mutation or dispatch.

Recovery validation: 30 observer, 55 Retro and 175 workflow tests pass.
These retain Builder Actions-read and Retro read/Issue-write limits. The
read-only preview verifies actual ledger reconciliation, not publication.

Independent paginated merged-PR search over the same fixed window returns the
same 119 distinct PR numbers as the input. Fresh paginated `pulls/<number>/files`
reads for every PR classify 51 as loop, 15 as spec and 53 as product under L106's
Delivery clause; all 119 individual classifications match. Empty PRs use their
named scenarios. The remaining metrics and a successful authorized pair remain
pending, so these delivery counts do not complete acceptance.
