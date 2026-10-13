# L82 six-hour fix observation

Work Issue: #1350. Acceptance Issue: #1290. Collector: `loop/fix-observer.py`, merged in #1352 at `7b7b15b142264e09acb494824dbd67f77db70354`.

| Evidence | Result |
|---|---|
| Required window | 2026-10-13T00:53:38Z through 2026-10-13T06:53:38Z |
| Fixture validation at 03:28Z | `python3 loop/fix-observer.test.py`: 25 tests passed |
| Worktree validation before live collection | `pnpm install` and `just check` passed; 1,504 Rust tests and 2,461 frontend tests passed (2 skipped) |
| Validation after merging newer main | `pnpm install` and `just check` passed; 1,530 Rust tests, `ALL PROOFS CHECK`, and 2,527 frontend tests passed (2 skipped) |
| Fix-run validation on main `f4b2ba19` at 04:17Z | `pnpm install`, 25 L82 fixtures and `just check` passed; 1,530 Rust tests, proofs and 2,527 frontend tests passed (2 skipped) |
| Complete live report | Pending; collection before the window ends cannot demonstrate acceptance |
| Persisted artifact and per-identity counts | Pending |
| Issue completion | #1290 and #1350 remain open |

```text
after 06:53:38Z
  trusted main build job runs L82 fixtures
  collector reads the complete bounded window
  upload-artifact persists report.md, evidence.json and admission summaries
  publisher links the artifact on #1290 and #1350
  every criterion passes → close both Issues
  missing evidence or failed criterion → keep both Issues open
```

After the window ends, a run reads the `<!-- l82-fix-observer -->` comments on both Issues and the linked artifact, records its URL and each criterion here, and checks that raw dispatch repeats remain visible separately from proved admissions. It does not replace the required six hours with a shorter sample. If the scheduled main job has not produced evidence after the window ends, run the trusted main build workflow; do not dispatch a fix or change admission or gates. This record is ready for review of the fixture evidence and collection handoff; it does not demonstrate live acceptance or close either Issue. The main workflow owns the remaining observation independently of this PR.
