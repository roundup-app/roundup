# U2556 Rail fix observer

Before-fix baseline: ea702e3261fb19f4230eefdd3556e9070f1434f6. Main regression baseline: 480228a0c685f1b84762321f21907a539c1cc135 (`main-*.checks.json`); the same D6/D7 checkbox failures and D10 aggregate occur, with all other Checks passing. Head: this fix, after merging origin/main at 6e2446619.

Observer: isolated headless agent-browser session `builder-39111391557`, fresh `/tmp/2648-browser` profile; U26 `tree-40` harness, 1512×950, light and dark. No native Mac observation.

Through `window.__fake`, the registered Agent nodes receive Worktrees, with one long name. The `agent.worktreeState` handler returns ahead 999, fresh failed CI on `tokens`, stale passed CI on `logins`, fresh running CI on `migrate`, stale failed CI on other Agents, and stale PR #2531. Emit `rail.changed` to publish these identities. Baseline and head use the same fixture.

| Observation | Baseline | Head |
| --- | --- | --- |
| CI and PR on narrow nested rows | Hidden | Visible; wrap within the row |
| Stale pass and stale PR | Visible text omits stale | Visible text includes stale |
| Name and state before actions | Present | Present |
| D2 and D5 | Pass | Pass |
| D6, D7 | Todo checkbox hover/press failures | Same failures |
| D10 | Aggregates D6/D7 failures | Same failures |
| Other Checks | Pass | Pass |

Select `logins` and open the `topic` Worktree view. Replacing the handler with a `worktree_missing: /p/logins` rejection exposes the full failure in the view. The dark failure screen's readings are `head-view-dark.checks.json`.

The adjacent JSON files are the raw `window.__checks()` readings. Screenshots remain untracked artifacts, following the capture policy. The CSS reuses flex wrapping: facts remain present instead of being removed by container queries. Existing behavior tests cover accessible state and shared facts; the visual differences above are rendered observations, not exact-copy/layout assertions.
