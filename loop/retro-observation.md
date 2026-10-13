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

Recovery uses the explicitly authorized run ID from the original dispatch job
and live evidence, requiring it to be an Actions-authored delivery created after
intent and absent from the pre-dispatch run list. Ordinary intents require a
unique candidate; missing or multiple deliveries remain unknown and cannot
trigger a retry. The observer persists identity before reading completion.
Subsequent reads use that ID, so later diagnostics do not change its identity.
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

Recovery validation: 31 observer, 55 Retro and 175 workflow tests pass.
These retain Builder Actions-read and Retro read/Issue-write limits. The
read-only preview verifies actual ledger reconciliation, not publication.

Independent paginated merged-PR search over the same fixed window returns the
same 119 distinct PR numbers as the input. Fresh paginated `pulls/<number>/files`
reads for every PR classify 51 as loop, 15 as spec and 53 as product under L106's
Delivery clause; all 119 individual classifications match. Empty PRs use their
named scenarios. The remaining metrics and a successful authorized pair remain
pending, so these delivery counts do not complete acceptance.

After merging `origin/main` at `19c6adaa`, `pnpm install` and `just check`
passed: 1,617 Rust tests, 2,818 web tests (11 platform/opt-in skips), and
`ALL PROOFS CHECK`. All 31 observer, 55 Retro and 175 workflow tests pass;
Builder, scenario-id and vocabulary checks also pass. The diff against that
main contains only this evidence, observer, observer tests and dispatch job.

## Independent Issue-source audit after #1569

[Recovery PR #1569](https://github.com/saadshahd/roundup/pull/1569) merged at
2026-10-13T23:24:18Z. This audit still uses owner-dispatched
[run 38457744271](https://github.com/saadshahd/roundup/actions/runs/38457744271)
and [report #1525](https://github.com/saadshahd/roundup/issues/1525), with the
same `[2026-10-12T19:48:27Z, 2026-10-13T19:48:27Z)` window. It proves neither
a successful authorized pair nor completed L106 acceptance.

The downloaded `retro-input.json` SHA-256 is
`c016b983e95559164d2df16c2e5ea7404b178bb25ae6218194a5ccf8b5c5c5d1`.
[retro-1308-source-counts.json](retro-1308-source-counts.json) records the
independent totals and every contributing comment/event link. Fresh paginated
GitHub reads covered the all-state Issue listing and 1,130 comment/event/review
endpoints for 362 relevant objects. This selection also included old closed
Issues retaining `flag:needs-user`, so their source histories could be checked.
The count did not call Retro's collector or use its aggregates. It clipped
comments and label events to the fixed window, counted bot markers, reconstructed
open/closed state for strike holds and replayed label additions/removals.

| Metric | Report | Independent source count | Result |
|---|---:|---:|---|
| fix_attempts | 83 | 83 | match |
| fix_nopush | 1 | 1 | match |
| fix_push_unknown | 83 | 83 | match; absence of a recorded push remains unknown |
| strikes | 18 | 18 | match |
| held_by_strikes | 0 | 0 | match |
| owner comments supplied | 23 | 23 | match of source count; fulfilment judgement remains policy |
| flaky_issues | 4 | 2 | false positives; prerequisite #1587 |
| needs_user | 3 | 31 literal label intervals | closed retained labels unresolved; prerequisite #1590 |
| needs_user_seconds | 106,223 | 2,525,423 from literal label boundaries | same unresolved boundary |

### Flaky-test diagnosis defect

Only [#1357](https://github.com/saadshahd/roundup/issues/1357) and
[#1388](https://github.com/saadshahd/roundup/issues/1388) diagnose the named tests
that their own work repairs. [#1336](https://github.com/saadshahd/roundup/issues/1336)
requests daily Care; [#1504](https://github.com/saadshahd/roundup/issues/1504)
requests loop handling and test standards. Their references to other flaky-test
work motivate features, rather than diagnose tests they own.

Replaying the four actual Issue bodies through `retro.collect` and the existing
`FakeGitHub` from `loop/retro.test.py`, with end `2026-10-13T19:48:27Z`, returns
all four again. The collector's pre-Expected keyword/link predicate admits
these feature requests. L106's Failures clause requires a recorded diagnosis.
[#1587](https://github.com/saadshahd/roundup/issues/1587) owns this collector
repair and its positive/negative regression fixtures; it blocks #1308.

### Closed label histories require reconciliation

The independent label replay adds 28 old closed Issues with no removal before
end: 615, 609, 440, 439, 403, 375, 374, 361, 358, 356, 343, 334, 327, 325,
324, 323, 322, 320, 318, 317, 314, 313, 312, 311, 309, 296, 290 and 226.
Each adds 86,400 seconds under literal label-addition/removal boundaries;
`106223 + 28 * 86400 = 2525423`. This is a source discrepancy, not a claim
that a closed work order still needs user action.

For example, [#615](https://github.com/saadshahd/roundup/issues/615) retains the
label from [event 32951992465](https://api.github.com/repos/saadshahd/roundup/issues/events/32951992465)
at 2026-10-10T17:58:47Z, closed at 18:45:46Z, and has no removal event.
Retro omits this old closed object's history. However, its recorded interval
for [#1295](https://github.com/saadshahd/roundup/issues/1295) continues until the
fixed end, although that Issue closed at 2026-10-12T22:46:14Z. Source selection
uses closure while interval arithmetic does not. Silently discarding histories
cannot independently establish the User waits metric.

[#1590](https://github.com/saadshahd/roundup/issues/1590) owns reconciliation
against L106's event boundaries, including explicit missing end evidence and
a consistent treatment of closure. It blocks #1308 and must preserve owner
closure without reopening work. The report's three selected intervals and their
106,223-second sum are individually reproduced, but completeness is unproven.

### Remaining observation

At 2026-10-13T23:39Z, no post-recovery Retro dispatch appeared in Actions and
#1308 still held the original intent. The examined build runs
38484617883, 38484694929 and 38484873429 skipped `retro-observer`; the main check
runs were still incomplete. A skipped job does not exercise the merged recovery.
The next eligible main workflow tick owns that transition with Actions write;
this Builder made no dispatch and changed no role permission.

Queue rows/statistics, main failures, all per-PR model counts, semantic owner
fulfilment, unknown causes/model evidence, repair deduplication, predecessor
closure and same-date publication reuse remain unverified in this audit. The
input records 2,323 unknown model-work rows and six unknown unmerged causes;
these are not confirmed zeros. Neither these stored input values nor the passing
fixtures replace source reconciliation for two successful authorized dispatches.
The two collector prerequisites must settle before #1308 can complete.

Regression validation on `9a51d2b6`: all 31 observer, 55 Retro and 179 workflow
tests pass, including Builder Actions-read and Retro read/Issue-write limits.
