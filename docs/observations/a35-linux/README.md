# A35 Linux observation — incomplete

Work order: [#1395](https://github.com/saadshahd/roundup/issues/1395), prerequisite for [#1380](https://github.com/saadshahd/roundup/issues/1380).

Observation window: 2026-10-13T03:47:46Z through 2026-10-14T03:47:46Z.
This partial evidence does not demonstrate the 24-hour acceptance. Both Issues remain open.

## Existing repair evidence

[Repair #1382](https://github.com/saadshahd/roundup/pull/1382) merged as
`f4b2ba193179ef32bc29f00572d64b50263d71b9` at 2026-10-13T03:47:46Z.
[Linux Builder run 38338828487](https://github.com/saadshahd/roundup/actions/runs/38338828487)
recorded 20 consecutive nextest runs of all 23 A35 tests: 460 passes, zero failures.
The existing Mark assertions remain unchanged. This evidence PR changes no implementation.

## Inspected attempts

| Main check run | Attempt | Linux job | Started (UTC) | Completed (UTC) | Result |
| --- | --- | --- | --- | --- | --- |
| [38343389624](https://github.com/saadshahd/roundup/actions/runs/38343389624) | 1 | [115119190482](https://github.com/saadshahd/roundup/actions/runs/38343389624/job/115119190482) | 2026-10-13T03:47:52Z | 2026-10-13T04:04:42Z | success; no A35 failure in the downloaded Linux log |
| [38344464119](https://github.com/saadshahd/roundup/actions/runs/38344464119) | 1 | [115122520247](https://github.com/saadshahd/roundup/actions/runs/38344464119/job/115122520247) | 2026-10-13T04:01:33Z | 2026-10-13T04:21:25Z | Linux success; overall run cancelled; no A35 failure in the downloaded Linux log |

The downloaded log's A35 lines and test summaries are preserved in
[38343389624-attempt-1-linux.txt](38343389624-attempt-1-linux.txt).
The Actions API reported one attempt when inspected on 2026-10-13 at approximately 04:16Z.

The second attempt's A35 lines and summary are preserved in
[38344464119-attempt-1-linux.txt](38344464119-attempt-1-linux.txt).
Its overall run was cancelled, but its Linux job completed successfully.
The API reported one attempt when rechecked at approximately 04:25Z.

The third run's attempt 1 Linux job
[115125207055](https://github.com/saadshahd/roundup/actions/runs/38345302504/job/115125207055)
started at 2026-10-13T04:12:13Z and completed successfully at
2026-10-13T04:32:02Z. Its downloaded log contains 40 A35 passes and no
A35 failure; the lines and summary are preserved in
[38345302504-attempt-1-linux.txt](38345302504-attempt-1-linux.txt).
The API reported one attempt when inspected at approximately 04:43Z.

## Remaining observation

Enumeration at approximately 04:43Z returned four main check runs since merge.
The first three are inspected above; run
[38346951778](https://github.com/saadshahd/roundup/actions/runs/38346951778)
(created 2026-10-13T04:32:41Z) remains in progress and uninspected.
Later runs and any later attempts still need inspection after the deadline.

At or after the deadline, enumerate all pages of main check runs created within
this window. Inspect every attempt separately, including unsuccessful attempts
before successful reruns. Wait for relevant jobs to finish. Record URLs, timestamps,
and A35 failures from each Linux log. An unavailable log leaves acceptance unproved.
Do not replace earlier attempt evidence with a rerun's result.

If any A35 test fails, report its exact name and run on #1380 and retain that
Issue for repair under its existing scope. Otherwise complete this evidence in a
reviewed PR closing #1395; only then may #1380 close with its full acceptance proved.
