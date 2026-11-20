# UI: an async read that rejects shows its failure (U7776a)

Module: `apps/desktop/src/changes/`, `apps/desktop/src/settings/`, `apps/desktop/src/pads/` and `apps/desktop/src/state/`, plus the lint that flags the pattern. Ids: U7776a, U7776b. Work order: [#7776](https://github.com/roundup-app/roundup/issues/7776). Found while fixing #7758 (#7671): when `project.compareRefs` rejects, the Changes view shows only its header and Solid logs `REACTIVITY_HALTED`.

**U7776a a rejected read shows its failure and a Retry.** Given an async read behind a `createMemo` or `createSignal` body (the Changes view's `project.compareRefs` choices, and each read in the Scope of #7776 that can reject uncaught), when its call rejects with an `RpcError`, then:
- **Failure in place.** The view shows the failure message where the result would show, as the `agent.changedFiles` read beside it already does through `failureOf`, and a `Retry` that reads again. Asserted per read in `u7776a_<read>_rejection_shows_failure_and_retry`, the Changes view's being the S3806b rejected-call case (`scenarios/app.md`).
- **Retry recovers.** Activating `Retry` after the Daemon answers again shows the result and removes the failure. Asserted in `u7776a_changes_choices_retry_recovers`.
- **Nothing uncaught.** No rejection reaches Solid uncaught: the reactive system is not halted and no unhandled `RpcError` is logged. Asserted in the same tests by a failing test on an unhandled rejection.
- **Audit.** Each read in the Scope is checked; a read that cannot reject uncaught (already guarded) is left unchanged and named with its reason on the Issue. The fix reuses `failureOf` and adds no failure helper.

**U7776b a lint flags an async reactive read with no failure handling.** Given a `createMemo` or `createSignal` whose body starts with `async` and has no `failureOf`, `try` or `.catch` around its awaited call, when `just lint` runs, then it fails naming the file. Asserted in `u7776b_lint_flags_unguarded_async_reactive_read`, with one flagged and one guarded fixture. Policy: if no cheap lint covers it, the implementation says so on the Issue and U7776b retires with that reason.

Policy: rule 10 holds, so the tests name only the rejection, the failure text, the Retry and the call count; layout and looks are the design critic's. Moves no Check.

Checks on main (numbered references, not claims that this specification implements them):

1. `apps/desktop/src/app/failureOf.ts`, function `failureOf`: the pattern reused.
2. `apps/desktop/src/changes/harness.tsx`, function `mountControl`: the fake App whose `handlers["project.compareRefs"]` the test makes throw.
3. `scenarios/app.md`, heading **S3806b choosing an action outlives its surface**: the rejected-call clause.
