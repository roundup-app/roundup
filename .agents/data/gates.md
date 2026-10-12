# Gates

Data for review runs. Rule numbers are `AGENTS.md`'s.

## Merge

GitHub auto-merge merges a PR once the ruleset's required checks pass on its head (L46): `check`; `rules`, which also needs `Author-Agent` on every authored commit (L2) and a head that undoes no work `main` merged after its branch started, unless an `Undoes:` trailer declares it (L101); `review`, the status the review workflow posts from a review run's verdict on that head; `percy`, which builds only when `apps/desktop/src` changes; and `critic`, the status the critic workflow posts from a design-critic run's verdict on that head (L103), `success` at once when `apps/desktop/src` is unchanged. A `critic` reject blocks merge as a `review` reject does; a `review` approve never clears it. Every head gets its own review, and its task carries the earlier verdicts. Reject a Code or Loop PR without a `Scenarios:` line. Loop changes pass the same review and required checks. Earlier rejects do not veto a corrected head; a PR that used its fix runs is closed and its Issue gets the causes (L82).

## Verdicts

A verdict is a comment the review workflow posts (L24), or a `CRITIC:` comment the critic workflow posts in the same shape (L103), or one a person with write access posts; no other comment counts.

```
VERDICT: approve|reject
Head: <full SHA reviewed>

<one finding per line: `rule <n>: <file>:<line> <defect>`, or `NOTE: <text>` in an approve>

Reviewed-by-Agent: <id differing from every Author-Agent>
```

Until a script checks them, `tokens` (L41) are checked by hand.
