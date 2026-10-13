# L106 collector observation: #1386

Recorded failure → authorized intent → one main Retro → terminal collection evidence.

| Evidence | Record |
| --- | --- |
| Work Issue | [#1386](https://github.com/saadshahd/roundup/issues/1386), one diagnostic dispatch after terminal failure 38338087106 |
| Main checkout | `7b7b15b142264e09acb494824dbd67f77db70354` |
| Predecessor | [Retro 38338087106](https://github.com/saadshahd/roundup/actions/runs/38338087106), exit 4 on HTTP 502 reading `actions/runs/38291632155/jobs?filter=all&per_page=100`; no complete input or window |
| Authorized observer | [main build 38341170945](https://github.com/saadshahd/roundup/actions/runs/38341170945) |
| Intent before dispatch | [#1315 intent](https://github.com/saadshahd/roundup/issues/1315#issuecomment-6137445730), requested at `2026-10-13T03:19:46+00:00`; prior runs `[38338087106, 38327525724, 38309102644]` |
| Correlated delivery | [#1315 correlation](https://github.com/saadshahd/roundup/issues/1315#issuecomment-6137451575): [Retro 38341186753](https://github.com/saadshahd/roundup/actions/runs/38341186753), created `2026-10-13T03:19:48Z` on the main checkout above |
| Collector | [job 115112311838, step 3](https://github.com/saadshahd/roundup/actions/runs/38341186753/job/115112311838#step:3:1), failed at `2026-10-13T03:37:07Z`, exit 4: GitHub read timed out after 180 seconds |
| Input and window | [artifact API](https://api.github.com/repos/saadshahd/roundup/actions/runs/38341186753/artifacts) returned `total_count: 0`; no complete retro-input artifact and no exact half-open window exist |
| Model and publication | Artifact upload, model invocation and publication steps all skipped; job completed with failure at `2026-10-13T03:37:10Z` |
| Observer terminal record | [#1315 terminal state](https://github.com/saadshahd/roundup/issues/1315#issuecomment-6137672085): `collected: true`, `conclusion: failure`, `window: null`, `artifacts: []`; consumed intent remains recorded |
| Terminal progress record | [#1315 evidence](https://github.com/saadshahd/roundup/issues/1315#issuecomment-6137669845) and [#1386 evidence](https://github.com/saadshahd/roundup/issues/1386#issuecomment-6137670051) |
| Regression checks | `python3 loop/retro.test.py`: 44 pass; `python3 loop/retro-observer.test.py`: 25 pass; `python3 loop/workflows.test.py`: 145 pass |

The existing `build.yml` observer and `loop/retro-observer.py` are unchanged. Earlier intents, failed runs and #1308’s ledger are preserved. No second dispatch follows unknown delivery or failure. #1315 owns complete input, diagnosis and any repair; #1308 owns successful publications and independent reconciliation. This record claims neither acceptance.

## Terminal collection evidence

The failed read was `repos/saadshahd/roundup/actions/workflows/check.yml/runs?per_page=100`. The paginated `gh api` read exceeded its 180-second timeout. This records the non-secret cause for this run, not a diagnosis of the earlier 502s or the original discarded failure. No collector retry or policy change was made.

The [collector log](retro-1386-collector.txt) retains every line from the collector step with ANSI formatting removed and the workflow-masked credential. No window is inferred from a partial read. The single authorized dispatch and terminal collection evidence satisfy #1386; they do not satisfy #1315’s complete-input acceptance or #1308’s publication reconciliation.

On the original main checkout `7b7b15b1`, `pnpm install --frozen-lockfile` and `just check` exited 0: 1,504 Rust tests, message proofs, lint, type checks and 2,461 desktop tests passed (two skipped).
