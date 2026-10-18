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

## One-line Rail repair (builder-39113217301)

Observer: isolated headless `builder-39113217301`, fresh `/tmp/2648-fresh-browser`, 1512×950. `agents-10` gives every Agent a Worktree, ahead 70, PR #3991, failed CI on agent-3, running CI on agent-9, and stale passed CI/PR on agent-2 and agent-7; agent-1 has a 63-character name. The before capture temporarily applies the rejected head's original Rail stylesheet to the same fixture. The after capture removes that override.

| Before | After |
| --- | --- |
| Worktree rows wrap to 43 px | All nine rows are 32 px |
| Chips beneath the name | Ahead and CI beside the name, actions trailing |
| Every PR consumes row space | PR stays on wider fresh rows; narrow/stale rows retain it in the Worktree view |
| Stale facts include visible stale text | Same text retained, with reduced emphasis |

`critic-before.checks.json`, `critic-after-light.checks.json` and `critic-after-dark.checks.json`: every Check passes. `critic-row-readings.json` records all nine heights and Chip visibility. Screenshots are `/tmp/2648-before.png`, `/tmp/2648-after-light.png` and `/tmp/2648-after-dark.png` in this run; PNGs remain untracked. The `tree-40` dark observer adds fresh failed CI and a rejected local read; raw readings are `critic-tree-dark.checks.json`. No native Mac claim.

The dense failure screen opens `logins` → `topic`: `worktree_missing: /work/logins` is visible in the Worktree view (`/tmp/2648-tree-failure.png`). D6/D7's existing Todo checkbox failures and D10 aggregate persist; all other Checks pass, matching the main baseline recorded above.

Validation: `pnpm install --frozen-lockfile`, `just lint-web`, `just lint-rust` and `loop/rules.sh merge-loss` pass. Proofs print `ALL PROOFS CHECK`. All ten focused U2556 tests pass. The CSS-related set runs 195 files / 1,516 tests across four shards: 1,511 pass and five time out under parallel load. All five affected files pass with `--maxWorkers=1` (25 tests). An earlier unsharded process ended with exit 143 before completion. No tests changed.
