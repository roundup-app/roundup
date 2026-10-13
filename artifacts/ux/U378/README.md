# U378

```text
+ Agent → Project defaults
▾ → Model + Effort → Add agent
                    Esc → discard choices
failed add → keep pair and show error → retry
```

Source: `62242014`; main baseline: `eaa7dadf`.

The Enter observer opens a Project from `first-run` and creates a Workstream; `agents-10` and `tree-40` cover populated Rails. Each runs at 1280×800 and 1440×800, light and dark, with 20 Models whose labels have 40 characters. Captures show closed, open, changed pair and failed add states. Failure text wraps within the Rail and stays above its footer.

`u378_the_split_add_renders_without_overflow` asserts picker bounds, visible failure text and D1/D2/D5/D6 in every failed state. `u378_the_split_add_preserves_design_checks` compares each main Check that passes against the corresponding closed head state. `u378_the_split_add_runs_from_the_keyboard` drives real Tab, Enter, Space and Escape on isolated Chromium. Behavioral tests in `u378_model.test.tsx` assert spawn parameters, defaults, retry, focus and composing-field guards.

Captures come from `ROUNDUP_RAIL_BASELINE=http://127.0.0.1:5299 just capture U378`, using headless Chromium with fresh profiles. A separate `agent-browser` session, `builder-38383125351`, inspected the closed, open and failed states; its temporary profile and browser were owned by this run and closed afterward. No native Mac observation is required by U378.

The earlier captures of the failed `first-run` state failed D3 and aggregate D10 on both main and head: D3 treats a Workstream without an errored or needs-you Agent as calm and rejects its red failure line. `*-base-failed.checks.json` records that historical failure; no passing main Check regressed in the corresponding closed or failed state.

## Rail inset repair

At the default 288 px Rail, only the split add's Agent label collapses. The list retains its leading `--space-4` inset and visible scrollbar; its compact layout still begins at 252 px. The focused Workstream's outline fits within the scrolling list. `u172_the_split_add_keeps_the_default_rail_inset_and_focus_ring` failed before the repair and passes in light and dark afterward.

The closed, open, changed and failed captures were refreshed after merging main `956c027d`. The isolated headless `agent-browser` session `builder-38392762803` also inspected the focused tree-40 row at 1280×800: every design Check passed. Its browser was closed after observation.

The refreshed failed-state captures include main’s U464 error observation repair. All refreshed U378 capture Checks pass.
