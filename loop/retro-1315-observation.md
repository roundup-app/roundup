# L106 collector observation

Refs #1315. Publication and independent reconciliation remain with #1308.

Merged repair #1464 → owner-dispatched main collection → input artifact observation.

The owner dispatched [Retro 38390491397](https://github.com/saadshahd/roundup/actions/runs/38390491397)
on main `30aab46eba11c6f3f7c7efe82bb235e7485a0f4b` after merging
[PR #1464](https://github.com/saadshahd/roundup/pull/1464).
This Builder observes with Actions-read authority and dispatches nothing.

The original [run 38309102644](https://github.com/saadshahd/roundup/actions/runs/38309102644)
discarded GitHub's failed response. Its specific cause remains unknown.
Later workflow-authority runs establish HTTP 502, HTTP 503 and a historical
check-list timeout, as recorded on #1315; those failures do not establish the
original response's cause. #1316 supplies safe diagnostics; #1407 bounds
historical pagination; #1464 retries transient reads and bounds collection cost.

The owner closed #1462 because #1464 supersedes observation of the old collector.
Its [run 38386616763](https://github.com/saadshahd/roundup/actions/runs/38386616763)
was cancelled during collection at 2026-10-13T11:29:09Z; its artifact API returns
zero artifacts. Its dispatch intent remains on #1315.

On the observed main SHA, `python3 loop/retro.test.py` passes 52 tests,
`python3 loop/retro-observer.test.py` passes 25 and
`python3 loop/workflows.test.py` passes 164.
`l106_transient_read_failure_gets_another_try` reproduces HTTP 502/503 and
timeout recovery through `GitHub.read`. `l106_read_fails_loud_after_five_transient_failures`
proves terminal exit 4, the failed endpoint and HTTP cause, and empty input
through the collector command. Writes still receive one try.

The repair exposes `queue_workflows` and measures queue waits only for model
workflows. #1464 explicitly records that this differs from L106's every-workflow
Wait clause. A successful upload alone does not prove that clause or complete
#1315's full acceptance.
