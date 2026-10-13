# L23 command-wait observation

Refs #1355. Refs #1370. Change: [PR #1358](https://github.com/saadshahd/roundup/pull/1358), merged 2026-10-13T02:02:17Z.

**Incomplete.** The observation interval is 2026-10-13T02:02:17Z through 2026-10-14T02:02:17Z. This snapshot was collected on 2026-10-13 before the interval ended. It cannot demonstrate acceptance or close #1370. Unknown results are not passes; no violation has been established from this snapshot.

| Workflow run | Builder job | Evidence | Premature model turn ending |
| --- | --- | --- | --- |
| [38335225143](https://github.com/saadshahd/roundup/actions/runs/38335225143) | [#1355](https://github.com/saadshahd/roundup/actions/runs/38335225143/job/115093807770) | Completed; public log ends with `item.completed command_execution` at 02:10:15.7685379Z, then `turn.completed` at 02:10:20.7069357Z. Command text, exit results and yielded session ids are absent. No execution artifact is listed. | Unknown: event kinds alone cannot prove every check or test exited before the turn ended. |
| [38335348746](https://github.com/saadshahd/roundup/actions/runs/38335348746) | #1338 | Job still running when queried. | Unknown; await completed logs. |
| [38335582921](https://github.com/saadshahd/roundup/actions/runs/38335582921) | #1369, #1370 | Both jobs still running when queried; #1370 is this observation run. | Unknown for each job; await completed logs. |
| [38335589609](https://github.com/saadshahd/roundup/actions/runs/38335589609) | None | Jobs API reports the build matrix skipped. | Not applicable: no Builder model turn. |
| [38335656800](https://github.com/saadshahd/roundup/actions/runs/38335656800) | None | Jobs API reports the build matrix skipped. | Not applicable: no Builder model turn. |

## Collection and completion

The snapshot used `gh run list --workflow build.yml --created '2026-10-13T02:02:17Z..2026-10-14T02:02:17Z' --limit 100 --json databaseId,createdAt,status,conclusion,url`, each run's `gh run view <id> --json jobs`, and `gh run view <id> --log` for completed runs. The five returned workflows are all listed above. The artifacts API for run 38335225143 returned an empty list. Workflow success or failure does not determine command-wait compliance.

After 2026-10-14T02:02:17Z, repeat enumeration with pagination so no run is omitted, inspect each Builder job and any rerun attempt, and await jobs still running. Also include jobs active at the interval's start if their model turn ended inside the interval. Record each job's link, command completion evidence and model turn end. A tool returning a running command id is a yield, not completion: trace subsequent waits to an exit result before the model's final turn. Missing command/session evidence remains unknown, including when public logs contain `item.completed command_execution` without the underlying output. Public logging deliberately suppresses this detail (`loop/builder.py`, `codex`); this observation changes no logging, workflow or gate.

Close #1370 only after the interval is complete, at least one Builder run is observed, every applicable run is accounted for, and the evidence establishes zero premature turn endings with no unknown results. If a violation is found, record it and repair within #1355's existing scope before claiming acceptance. If no run occurs, the behavioral observation is inconclusive.
