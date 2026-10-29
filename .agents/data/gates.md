# Gates

Data for review runs. Rule numbers are `AGENTS.md`'s.

## Merge

GitHub auto-merge merges a PR once the ruleset's required checks pass on its head (L46): `check`; `rules`; `review`, the status the review workflow posts from a review run's verdict on that head; and `critic`, the status the design critic posts on a head that changes `apps/desktop/src/` (L103). Every head gets its own review; its task carries the scenarios' text from `main` and the earlier verdicts, whose findings the review re-derives against that head. Loop changes pass the same review and required checks. Earlier rejects do not veto a corrected head; a PR that used its fix runs is closed and its Issue gets the causes (L82).

## Scope

Scope is the PR's own commits' diff and the `loop/rules.sh merge-loss` result, judged against the Issue's scenarios, from git alone; the PR body is never scope. A scenario edit in the diff is in scope when the work order ("The work order:" in the task, the Issue the PR names) asks for it; reject one the order does not ask for, or one that loosens acceptance only to fit the diff. `merge-loss` (the `rules` job) fails a file only a merge changed; a merge's dropped main-side lines in own files show in `git show --remerge-diff <merge>`, and review weighs them against the scenario (L120).

## Reuse

Reject under rule 9 a missing required `Reuse:` section, or custom code where a maintained library covers the need and the section gives no specific rejection reason. In a new file or an edit, reject code that re-implements a feature of an installed dependency or the platform, or works around one (`!important` overrides of its styles, synthetic events, DOM clones, attributes copied onto its elements), unless the section names the capability it lacks. Read that section as verifiable library evidence only; the body never sets scope or proves a change (rule 5). Verify claims against the diff and cited sources. Existing merge checks and independent review still hold; a branch cannot satisfy its own gate.

## Verdicts

A verdict is a comment the review workflow posts (L24), or one a person with write access posts; no other comment counts.

```
VERDICT: approve|reject
Head: <full SHA reviewed>

<one finding per line: `rule <n>: <file>:<line> <defect>`, or `NOTE: <text>` in an approve, or in an approve one `FOLLOWUP: <finding>` block for a case the scenarios do not name (L24)>

Reviewed-by-Agent: <id differing from every Author-Agent>
```

A finding rejects only when an ordinary path reproduces it (or it is in `builder.md`'s always-reject list); one needing an injected failure, a held reply, a second writer, a component removed mid-edit, or code an earlier verdict reviewed unchanged is a `FOLLOWUP:` (L24).

Until a script checks them, `tokens` (L41) are checked by hand.
