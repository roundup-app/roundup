# U356 observer

`u356_two_blocked_agents_read_waits_on_their_own_blocker_collapse_to_blocked_and_the_jump_skips_them` (`apps/desktop/src/testing/u356_blocked_real_daemon.test.tsx`) runs on a real `rupd` with `FAKE_CLAUDE_KINDS` of `blocked, working, idle, working, idle` (Workstream 1) and `error, needs-you, blocked, error, needs-you` (Workstream 2). It asserts each row's glyph and word, that the two `blocked` rows wait on two different open `u356 blocker` Todos, the Workstream 1 row reading `blocked` when collapsed, the Workstream 2 row reading `error`, and `⌘J` visiting the four `error` and `needs-you` Agents and no `blocked` one.

## Rendered observer

Headless agent-browser (session `u356`) on `just harness-real` (U144) over a real `rupd` started with `FAKE_CLAUDE_KINDS` as above and `FAKE_CLAUDE_ON_PROMPT` so each Door is ready; both Workstreams and all ten Agents were started by pointer.

`blocked-1280x800.png`, `blocked-700x800.png`: the Rail with ten Agents; the two `blocked` rows show the `⏸` glyph, but the `waits on #<id>` label is squeezed to `wait…` (Workstream 1) or to nothing (Workstream 2) by the name, age and `◈ 2` badge, so the captures do not yet meet U356 Observed (#915). `blocked-*.checks.json`: `window.__checks()` for each. Only `u356_` asserts the collapsed rows (Workstream 1 `blocked`, Workstream 2 `error`); no capture shows a collapsed Workstream.

Not rendered: a Workstream collapsed over `needs-you` without `error`. The ten entries put both `error` Agents beside both `needs-you` Agents in Workstream 2, so no collapsed row reads `needs-you`; U351 observes that collapse (`u351_`).

## U364 observer (#915)

`u364_a_blocked_row_shows_its_whole_waits_on_label_at_1600_and_is_cut_at_1280_and_700` (`apps/desktop/src/testing/u364_real_daemon.test.ts`) starts the same ten Agents on a real `rupd` in headless Chromium and reads each `blocked` row's `.live-label`. `blocked-1600x800.png`, `blocked-1280x800.png` and `blocked-700x800.png` come from it, each with `window.__checks()`.

Measured at 1600 by 800: the Rail's default is 288 px (U389), not the 320 px U364 names, and the label is cut there (`clientWidth` 32 and 17 of `scrollWidth` 94 and 102). It is still cut at 320 px (64 and 49), because the row also holds the badge, name and age; it is whole from 400 px (144 and 129). The test therefore widens the Rail to 400 px through its Resize edge (ArrowRight), asserts `scrollWidth` at most `clientWidth` on both rows, captures, then resets the Rail with Enter and captures 1280 and 700 at the default, where the label is cut and the age's right edge stays inside the row (U7).
