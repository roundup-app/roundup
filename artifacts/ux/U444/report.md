# U444 observer

Baseline: main `fc11ba9c`. Head: this PR. Chromium on fresh profiles, no native Mac claim.

| Observer | Result |
| --- | --- |
| `resources`, selected `worktree-agent`, 1280×800 and 700×800, light/dark | All six Agent and Project values remain visible and whole. Wide centres reserve 24 px; narrow centres reserve 48 px, with Project totals on the second row. |
| `thread-report`, 1280×800 and 700×800, light/dark | Strip is the centre stack's last child after Thread, aligns with both composer sides, and sits 16 px below the composer, equal to the centre’s side gap. |
| Resource call failure | `Not updating`, all three Agent values and the last Project totals fit without clipping at both widths. |
| `loop/rules.sh delta base head` | D1–D14 still passing at every observed viewport and scheme. |

The `resources` seed contains root Agents, which have no Thread composer. The placement observer therefore uses `thread-report`; the dense-value observer uses `resources`. The Shelf is closed in these observations. Its pre-existing overlap is outside this fix.

`u444_the_strip_is_the_centres_last_line_under_the_composer` reads DOM order and rendered rectangles. `u444_the_dense_strip_clips_no_value` requires all six dense values and checks every value and failure word, including hidden elements, against the strip and window bounds. `just capture U444` selects only these captures; ordinary checks write none.
