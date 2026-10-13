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

## Follow-up after merged repairs

[PR #1472](https://github.com/saadshahd/roundup/pull/1472) merged the declared
model-workflow queue boundary and completed specification prerequisite #1470.
That prerequisite no longer blocks #1315.

[Run 38390491397](https://github.com/saadshahd/roundup/actions/runs/38390491397)
ended at 2026-10-13T12:22:32Z. Its
[collector log](https://github.com/saadshahd/roundup/actions/runs/38390491397/job/115272956566#step:5:1)
identifies `actions/jobs/114918798594/logs`: `HTTP/1.1 404 The specified blob
does not exist.` Collection exited 4, artifact upload was skipped and the
model job was skipped. This is diagnosed subsequent evidence, not a claim
about the original run's discarded response.

[PR #1474](https://github.com/saadshahd/roundup/pull/1474), merged at
2026-10-13T19:47:21Z, records a missing historical job log as unknown model
work with `log: missing`; other failed reads still stop collection.
The existing collector tests assert the distinction:

| Test in `loop/retro.test.py` | Observation |
|---|---|
| `l106_missing_job_log_reads_as_none_without_retry` | The diagnosed blob 404 returns unavailable log evidence without retry |
| `l106_input_reports_missing_job_log_as_unknown_model_work` | Input counts unknown model work and exposes `log: missing` |
| `l106_job_log_refusal_fails_loud` | A 401 remains a failed read |
| `l106_read_fails_loud_after_five_transient_failures` | Exhausted 503 reads exit 4 with endpoint/cause and no input |

[Run 38410864244](https://github.com/saadshahd/roundup/actions/runs/38410864244)
failed before collection at the read-token step (`HTTP Error 401:
Unauthorized`); it supplied no complete input.

Merged #1474 → [main Retro 38457744271](https://github.com/saadshahd/roundup/actions/runs/38457744271)
→ pending complete-input observation.

That run checks out `c5a2efa00d87eca503c1246221675c5e6fde359c` and started
collection at 2026-10-13T19:48:27Z. At 2026-10-13T20:01:22Z, the jobs API
reports collection in progress, upload pending, and the artifacts API returns
`total_count: 0`. No complete input or exact window is claimed. This Builder
uses Actions reads only and dispatches nothing; previous run evidence and
#1308's ledger remain intact.

On this worktree's main base `ea6ddc04`, the collector, observer and workflow
suites pass 55, 25 and 168 tests respectively. #1315 remains open until a
main run finishes collection and uploads complete input with its exact window.
#1308 continues to own publication and independent metric reconciliation.
