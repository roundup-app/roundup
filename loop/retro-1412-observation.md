# L106 collector observation: #1412

Merged page repair → authorized intent → one main Retro → terminal collection evidence.

| Evidence | Record |
| --- | --- |
| Work Issue | [#1412](https://github.com/saadshahd/roundup/issues/1412), one diagnostic dispatch after terminal failure 38341186753 |
| Merged repair | [PR #1407](https://github.com/saadshahd/roundup/pull/1407), merged `2026-10-13T06:04:18Z`; merge `11f948f14f425d31141c42e9f10c51d03c43745a` is an ancestor of the Retro checkout |
| Retro main checkout | `223348646c521f1a7b7e746591df21d446464f2b` |
| Predecessor | [Retro 38341186753](https://github.com/saadshahd/roundup/actions/runs/38341186753); terminal evidence remains in [#1386 observation](retro-1386-observation.md) |
| Authorized observer | [main build 38361785036](https://github.com/saadshahd/roundup/actions/runs/38361785036); diagnostic dispatch step succeeded |
| Intent before dispatch | [#1315 intent](https://github.com/saadshahd/roundup/issues/1315#issuecomment-6140409664), requested `2026-10-13T07:18:14+00:00`; prior runs `[38341186753, 38338087106, 38327525724, 38309102644]` |
| Correlated delivery | [#1315 correlation](https://github.com/saadshahd/roundup/issues/1315#issuecomment-6140423164): [Retro 38361817247](https://github.com/saadshahd/roundup/actions/runs/38361817247), created `2026-10-13T07:18:17Z` |
| Collector | [job 115177550130, step 3](https://github.com/saadshahd/roundup/actions/runs/38361817247/job/115177550130#step:3:1), failed `2026-10-13T08:15:39Z`, exit 4; HTTP 503 on the jobs endpoint below |
| Input and window | [artifact API](https://api.github.com/repos/saadshahd/roundup/actions/runs/38361817247/artifacts) returned `total_count: 0`; complete retro-input and exact half-open window are absent |
| Model and publication | Artifact upload, model invocation and publication skipped; job ended with failure `2026-10-13T08:15:42Z` |
| Terminal progress record | [#1315 evidence](https://github.com/saadshahd/roundup/issues/1315#issuecomment-6141338470) and [#1412 evidence](https://github.com/saadshahd/roundup/issues/1412#issuecomment-6141338846) |
| Regression checks | `python3 loop/retro.test.py`: 47 pass; `python3 loop/retro-observer.test.py`: 25 pass; `python3 loop/workflows.test.py`: 163 pass |

The same observer job subsequently failed its separate #1308 publication observation: `dispatch delivery unknown: 5 matching runs; inspect intent, never redispatch`. Its diagnostic dispatch had already succeeded. This observation does not alter #1308’s ledger or claim publication reconciliation.

The existing `build.yml` and `loop/retro-observer.py` are unchanged. Earlier intents and failed runs remain preserved. No redispatch follows unknown delivery or a failed collection. #1315 owns diagnosis, repair and complete-input acceptance; #1308 owns ledger recovery, successful publications and independent reconciliation.

On the evidence checkout `6b54f9a1`, `pnpm install --frozen-lockfile` and `just check` exited 0: 1,538 Rust tests, message proofs, lint, type checks and 2,640 desktop tests passed (two skipped).

## Terminal collection evidence

The failed endpoint was `repos/saadshahd/roundup/actions/runs/38310401712/jobs?filter=all&per_page=100`. GitHub returned HTTP 503 Service Unavailable; `gh` exited 1 and the collector exited 4 before model invocation or publication. The retained headers report request id `67DE:242546:17F8A5D:4EFCF30:6ACDE8A6`, core read limit 5,000 and remaining budget 2,165. Earlier log lines record read-budget waits; the terminal cause is the HTTP 503, not the predecessor’s aggregate pagination deadline.

The [collector log](retro-1412-collector.txt) retains every collector-step line with ANSI formatting removed and the workflow-masked credential. No complete retro-input artifact exists, and no exact half-open 24-hour window can be read from it. No window is inferred from partial input.

The single authorized dispatch and terminal collection evidence satisfy #1412’s observation prerequisite. This failed collection does not satisfy #1315’s complete-input acceptance or #1308’s publication reconciliation. No automatic retry or new dispatch was made.

Fix-run verification on `dd25b4806998f0c9535db88cc9d1c891b13d3c11` after merging current `origin/main`: `pnpm install --frozen-lockfile` and `just check` exited 0 (1,564 Rust tests; `ALL PROOFS CHECK`; lint and type checks; 2,653 desktop tests passed, two skipped). Collector, observer and workflow regressions passed 47, 25 and 157 tests respectively. The committed collector log matches GitHub’s terminal log after ANSI removal; the run API confirms failure and the artifact API still reports zero artifacts.

CI failure → isolated U351 pass → full check pass.

Fix-run verification on `2c7af0dbcfcc4210e70731292b04ea7427636129`: [check run 38376571684](https://github.com/saadshahd/roundup/actions/runs/38376571684) failed only U351's Door row assertion (`working` expected, `idle` received). The same U351 test passed alone and within a fresh `just check`, which exited 0: 1,564 Rust tests, `ALL PROOFS CHECK`, lint and type checks, and 2,653 desktop tests passed (two skipped). Collector, observer and workflow regressions also exited 0. No product, test, collector or workflow repair was made; this commit records verification and gives CI a fresh head within #1412's observation scope.
