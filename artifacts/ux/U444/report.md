# U408 / U444 / U469 observer

Baseline: main `33f9f819` (specification #1974 merged). Head: #1979. Fresh headless Chromium profiles; no native Mac claim.

| Observer | Result |
| --- | --- |
| `resources`, 1280×800 and 1440×800, light/dark | Only the selected Agent’s three values appear: `1.0 TB`, `1600%`, `12.3 TB` (the existing formatter promotes the seed’s 999.9 GB). No Project label or totals. |
| Failure / recovery / totals-only update | Last Agent values remain with `Not updating`; recovery removes it. Changing only totals changes no displayed number. |
| Empty selection / missing entry | Component observers cover done Agent, Workstream, Terminal, nothing and a missing entry while another Agent runs: empty resource region, no calls without a selected running Agent. Returning resumes polling; a running Door shows its own entry. |
| `thread-report` | Composer alignment and gap hold; rendered bar, pane and composer rectangles stay equal as Agent values disappear. |
| Sixteen long Terminal tabs, dense values, resource and close failures | All controls remain reachable, all three Agent values and both failure messages remain visible. Resource updates keep tab controls still. Clearing selection preserves the shared Terminal controls. |
| Baseline comparison | U444 and U469 baseline/head Checks pass in both schemes; no passing Check regresses. |

The exact observers are `u408_selection_and_samples_keep_project_totals_out_of_the_resource_region`, `u444_the_strip_is_the_centres_last_line_under_the_composer`, `u444_the_dense_strip_clips_no_value`, `u444_the_composer_does_not_move_as_the_strip_fills_or_empties` and U469’s bar, dense, update and selection observers. `u408_the_rail_holds_none_of_it` runs against both `tree-40` and `agents-10`.

Captures use the `just capture U408,U444,U469` entry’s `ROUNDUP_CAPTURES` mechanism, scoped to the two rendered observer files through `just packages test` after concurrent full-suite captures saturated memory and caused timeouts. The final scoped observers run with one Vitest worker. A separate isolated `agent-browser` session observed selected-Agent values and passing Checks at both widths. The user reports what they meet on the Mac.
