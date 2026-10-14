# L106 flaky-test diagnosis observation

Work: [#1587](https://github.com/saadshahd/roundup/issues/1587).
Report: [#1525](https://github.com/saadshahd/roundup/issues/1525),
[Retro run 38457744271](https://github.com/saadshahd/roundup/actions/runs/38457744271),
[complete original input artifact](https://github.com/saadshahd/roundup/actions/runs/38457744271/artifacts/11845827923).
Window: `[2026-10-12T19:48:27Z, 2026-10-13T19:48:27Z)`.

Independent inspection of every body the report counted gives **two diagnoses**:

| Issue | Created (UTC) | Owned diagnosis |
|---|---|---|
| [#1336](https://github.com/saadshahd/roundup/issues/1336) | 2026-10-12T23:55:25Z | No. Requests daily Care; cites other flaky-test repairs. |
| [#1357](https://github.com/saadshahd/roundup/issues/1357) | 2026-10-13T01:30:55Z | Yes. Five named real-Daemon tests fail at random; U356 read `working` instead of `blocked` on main at 01:26 and read the DOM before the Rail rendered it. |
| [#1388](https://github.com/saadshahd/roundup/issues/1388) | 2026-10-13T03:21:12Z | Yes. A35's ready-title test panicked in run 38340562996, commit 7b7b15b1, at `scenarios/a35.rs:489` with `NotFound`; it reads a file before the code writes it. |
| [#1504](https://github.com/saadshahd/roundup/issues/1504) | 2026-10-13T18:01:52Z | No. Requests loop handling and a test standard; its linked repairs own the affected tests. |

#1357 names `u356_blocked_real_daemon`, `u351_kinds_real_daemon`,
`u146_door_answers`, `u166_door_permission` and `u177_restarted_door`.
#1388 names `a35_a_ready_title_before_ack_still_delivers_the_reserved_prompt_first`
in `crates/agents/tests/scenarios/a35.rs`. Each retained row includes these
names, the recorded failure paragraphs, the complete body and its Issue source.

## Deterministic diagnosis representation

Inspection also covered #1525 (a report quoting failures), #1516 (implementation
request), #1523 (browser failure
investigation), #1524 (named test whose pass depends on runner load) and #1526
(named test reading its prompt log before the last prompt lands). These bodies
distinguish a recorded failure cause from a request to handle flaky tests.
Titles, scenarios and labels supply no test-failure evidence.

The collector excludes a requested reporting capability or generic test standard,
even when its motivation quotes a real flaky failure. It then uses the observation
preceding Expected/Observer/Scope/Acceptance.
It requires a named test declaration or named failure assertion, an observed
failure, and the diagnosis's explicit flaky condition: flaky/intermittent/random
failure, race, a test reading before its producer writes, or pass depending on
runner load. Paragraphs attributing a diagnosis to another Issue are references.
Marked Retro reports are not repair owners. Requested command and job names
are not test declarations. Found is read after any preceding work metadata. Unknown failure-run text
stays unknown; the classifier invents no run or failure link.

The four complete bodies and real creation timestamps are frozen in
`loop/retro.test.py`. `test_l106_input_counts_only_the_four_issues_owned_diagnoses`
calls the collector for this exact window and asserts two, all affected test
names and the recorded failure evidence. Other collector regressions cover a
loop-test diagnosis without labels, a loop-labelled generic reporting request,
linked diagnoses, a proposed reporting command, ordinary failures and explicit
unknown evidence. The existing fixed-window, pagination and unknown-metric
regressions remain in place.

## Complete live collection

The complete live input was collected on main commit
`c5a2efa00d87eca503c1246221675c5e6fde359c` in the linked Retro run, with
`collected_at: 2026-10-13T19:48:42.233792Z`. The downloaded artifact contains
80,503,318 bytes of JSON, SHA256
`c016b983e95559164d2df16c2e5ea7404b178bb25ae6218194a5ccf8b5c5c5d1`.

The collector recorded **5,386 source reads and 5,564 pages**. The all-state
Issue listing spans **16 pages, 1,506 distinct ids**. Its fixed window is the
interval above. Its flaky rows are exactly **#1504, #1388, #1357, #1336**;
independent body inspection counts **#1357 and #1388**, and the branch's
collector regression yields exactly those two with their failure evidence.

The full original input retains `fix_push_unknown: 83` and
`model_work_unknown: 2323`. These remain explicit unknowns; this repair does
not turn them into measured zeroes or reconcile the other metrics.

Independent live Issue reads during
[Builder run 38485170123](https://github.com/saadshahd/roundup/actions/runs/38485170123)
match the saved bodies for #1336, #1357 and #1388. #1504's only later body
change adds `Key: l109-flaky-tests`; its diagnosis is unchanged. The collector
fixture freezes the original main input bodies, not that later edit.

A redundant re-collection from main snapshot
`5cfadcfeff6cce2298106e247a4405d5dbad58f2` used:

```sh
python3 loop/retro.py --repo saadshahd/roundup input --end 2026-10-13T19:48:27Z
```

It paused for GitHub's read budget until 2026-10-14T00:43:29Z and was terminated
at that wait (exit 143), with no returned input or publication. It supplies
no complete-count evidence. The observation uses the complete immutable Retro
input linked above, read under existing Actions-read authority.


## Ownership after this prerequisite

[#1308](https://github.com/saadshahd/roundup/issues/1308) remains open. It owns
the two authorized successful publications, complete independent metric and
unknown reconciliation, same-date reuse, predecessor closure and repair-limit
and duplicate checks after this prerequisite merges. This observation collects
input only; it publishes no Retro report or repair and changes no authority.

## Validation

On the branch after merging main `d1e64cb3`, `pnpm install --frozen-lockfile`
and `just check` pass: 1,631 Rust tests, 2,860 web tests, and
`ALL PROOFS CHECK` (existing skips: one Rust test and eleven web tests). The collector's 64 tests, 188 workflow tests and 41 Care
tests also pass; vocabulary and scenario-id checks pass.

The first check attempt was stopped with exit 143 after discovering that its
shared Cargo output directory lacked the worktree `target/debug` path expected
by desktop fixtures. A worktree-local build-directory link repaired that setup.
That attempt also observed U466's editing test exceed its 5 s guard; the complete
corrected run passes it in 3,375 ms. This is a validation result, not a claimed
repair or diagnosis of U466 flakiness. No test timeout or assertion changed.
