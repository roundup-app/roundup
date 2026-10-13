# L106 collector observation: #1412

Merged page repair → authorized intent → one main Retro → terminal collection evidence.

| Evidence | Record |
| --- | --- |
| Work Issue | [#1412](https://github.com/saadshahd/roundup/issues/1412), one diagnostic dispatch after terminal failure 38341186753 |
| Merged repair | [PR #1407](https://github.com/saadshahd/roundup/pull/1407), merged `2026-10-13T06:04:18Z` |
| Retro main checkout | `223348646c521f1a7b7e746591df21d446464f2b` |
| Predecessor | [Retro 38341186753](https://github.com/saadshahd/roundup/actions/runs/38341186753); terminal evidence remains in [#1386 observation](retro-1386-observation.md) |
| Authorized observer | [main build 38361785036](https://github.com/saadshahd/roundup/actions/runs/38361785036); diagnostic dispatch step succeeded |
| Intent before dispatch | [#1315 intent](https://github.com/saadshahd/roundup/issues/1315#issuecomment-6140409664), requested `2026-10-13T07:18:14+00:00`; prior runs `[38341186753, 38338087106, 38327525724, 38309102644]` |
| Correlated delivery | [#1315 correlation](https://github.com/saadshahd/roundup/issues/1315#issuecomment-6140423164): [Retro 38361817247](https://github.com/saadshahd/roundup/actions/runs/38361817247), created `2026-10-13T07:18:17Z` |
| Regression checks | `python3 loop/retro.test.py`: 47 pass; `python3 loop/retro-observer.test.py`: 25 pass; `python3 loop/workflows.test.py`: 163 pass |

The same observer job subsequently failed its separate #1308 publication observation: `dispatch delivery unknown: 5 matching runs; inspect intent, never redispatch`. Its diagnostic dispatch had already succeeded. This observation does not alter #1308’s ledger or claim publication reconciliation.

The existing `build.yml` and `loop/retro-observer.py` are unchanged. Earlier intents and failed runs remain preserved. No redispatch follows unknown delivery or a failed collection. #1315 owns diagnosis, repair and complete-input acceptance; #1308 owns ledger recovery, successful publications and independent reconciliation.

On the evidence checkout `6b54f9a1`, `pnpm install --frozen-lockfile` and `just check` exited 0: 1,538 Rust tests, message proofs, lint, type checks and 2,640 desktop tests passed (two skipped).
