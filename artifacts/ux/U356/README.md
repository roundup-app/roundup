# U356 observer

`u356_two_blocked_agents_read_waits_on_their_own_blocker_collapse_to_blocked_and_the_jump_skips_them` (`apps/desktop/src/testing/u356_blocked_real_daemon.test.tsx`) runs on a real `rupd` with `FAKE_CLAUDE_KINDS` of `blocked, working, idle, working, idle` (Workstream 1) and `error, needs-you, blocked, error, needs-you` (Workstream 2). It asserts each row's glyph and word, that the two `blocked` rows wait on two different open `u356 blocker` Todos, the Workstream 1 row reading `blocked` when collapsed, the Workstream 2 row reading `error`, and `⌘J` visiting the four `error` and `needs-you` Agents and no `blocked` one.

## Rendered observer

Headless agent-browser (session `u356`) on `just harness-real` (U144) over a real `rupd` started with `FAKE_CLAUDE_KINDS` as above and `FAKE_CLAUDE_ON_PROMPT` so each Door is ready; both Workstreams and all ten Agents were started by pointer.

`blocked-1280x800.png`, `blocked-700x800.png`: the Rail with ten Agents; the two `blocked` rows read `blocked` by glyph and word, `waits on #5` and `waits on #22`. `blocked-*.checks.json`: `window.__checks()` for each. Collapsed, Workstream 1 read `blocked` and Workstream 2 read `error`.

Not rendered: a Workstream collapsed over `needs-you` without `error`. The ten entries put both `error` Agents beside both `needs-you` Agents in Workstream 2, so no collapsed row reads `needs-you`; U351 observes that collapse (`u351_`).
