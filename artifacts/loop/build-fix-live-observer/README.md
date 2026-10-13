# L23/L82 live build/fix exclusion

Passing evidence collected by the non-model [observer run 38324832095](https://github.com/saadshahd/roundup/actions/runs/38324832095), in its `branch-observer` artifact, and recorded on Issues #1322 and #1288.

| Observation | Result |
| --- | --- |
| Same-repository Builder PR | #1330, `build/l106-collector-authorized-dispatch` |
| Build holding the shared branch group | [38316693092](https://github.com/saadshahd/roundup/actions/runs/38316693092), job 115035131995 |
| Dispatch requested during build | 2026-10-12 23:13:07.831600 UTC |
| Fix run | [38320966124](https://github.com/saadshahd/roundup/actions/runs/38320966124) |
| Build completed | 2026-10-12 23:40:23 UTC |
| Fix task started | 2026-10-12 23:40:51 UTC; 28 seconds after build completion |
| Final and observed head | `14eb6d93a0acf745af3a6744f1e8f4172650cc7a` |
| Fix attempts before / after | 0 / 0 |
| Model work | Skipped |

```text
build holds branch → observer dispatches stale cause → fix waits
build ends → fix acquires → reads final head → skips stale cause
```

`intent.json` preserves the dispatch inputs (`pr: 1330`, zero head, `cause: check`). `evidence.json` preserves the completed jobs, run links, times, head, attempt counts and queue/acquisition/skip summary. The two summary files are the fix's downloaded artifacts. JSON values match the observer artifact; only whitespace around the historical `before` run-id arrays is compacted. Transient `pending.json` is superseded by the complete `evidence.json`.

Validate the evidence using `assert_evidence` in `loop/branch-observer.py`; `python3 loop/branch-observer.test.py` covers rejection of timing, head, attempt and summary failures. All 94 workflow/observer tests pass. After merging current main, `just check` passed: 1,492 Rust tests and 2,445 web tests, with two web tests skipped.

This evidence PR changes no workflow, permissions, coordination or required gate. Both Issues close only through the normal independent review and merge.
