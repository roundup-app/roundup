# L106 collector observation

Refs #1315. Publication and independent reconciliation remain with #1308.

Merged repair #1464 → owner-dispatched main collection → input artifact observation.

The owner dispatched [Retro 38390491397](https://github.com/saadshahd/roundup/actions/runs/38390491397)
on main `30aab46eba11c6f3f7c7efe82bb235e7485a0f4b` after merging
[PR #1464](https://github.com/saadshahd/roundup/pull/1464).
This Builder observes with Actions-read authority and dispatches nothing.

At 2026-10-13T11:52:35Z, the Actions jobs API reports collection in progress
and the artifacts API returns `total_count: 0`. No complete input or exact
window is claimed. This record retains that observation; it does not assert
the run's eventual result.
The final API observation at 2026-10-13T12:14:41Z still reports collection in
progress with zero artifacts.

The original [run 38309102644](https://github.com/saadshahd/roundup/actions/runs/38309102644)
discarded GitHub's failed response. Its specific cause remains unknown.
Later workflow-authority runs establish HTTP 502, HTTP 503 and a historical
check-list timeout, as recorded on #1315; those failures do not establish the
original response's cause. #1316 supplies safe diagnostics; #1407 bounds
historical pagination; #1464 retries transient reads and bounds collection cost.

| Workflow-authority evidence | Terminal read failure |
|---|---|
| [38327525724 collector](https://github.com/saadshahd/roundup/actions/runs/38327525724/job/115069559188#step:3:1) | `actions/runs/38299174806/jobs?filter=all&per_page=100`: HTTP 502; request ID `D00A:2DCD64:812A50:1A9B0EB:6ACD859E`, remaining core budget 2642; exit 4 |
| [38341186753 collector](https://github.com/saadshahd/roundup/actions/runs/38341186753/job/115112311838#step:3:1) | `actions/workflows/check.yml/runs?per_page=100`: timeout after 180 seconds; exit 4 |
| [38361817247 collector](https://github.com/saadshahd/roundup/actions/runs/38361817247/job/115177550130#step:3:1) | `actions/runs/38310401712/jobs?filter=all&per_page=100`: HTTP 503; request ID `67DE:242546:17F8A5D:4EFCF30:6ACDE8A6`, remaining core budget 2165; exit 4 |

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

[Specification prerequisite #1470](https://github.com/saadshahd/roundup/issues/1470)
owns that owner-selected queue boundary; #1315 is blocked by it. Its body passed
`python3 loop/orders.py check` before filing. It changes no collector authority
or publication/reconciliation ownership.

`pnpm install --frozen-lockfile` and `just check` exited 0 in this observation
worktree: 1,591 Rust tests, message proofs, lint/type checks and 2,665 desktop
tests passed (four desktop tests skipped). No collector code changed.
After the clean merge of main, the repeated `just check` also exited 0:
1,591 Rust tests, message proofs and 2,678 desktop tests passed (four skipped).
`git diff origin/main --stat` lists only this observation file.
