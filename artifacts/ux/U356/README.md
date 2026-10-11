# U356 observer

`u356_two_blocked_agents_read_waits_on_their_own_blocker_collapse_to_blocked_and_the_jump_skips_them` (`apps/desktop/src/testing/u356_blocked_real_daemon.test.tsx`) runs on a real `rupd` with `FAKE_CLAUDE_KINDS` of `blocked, working, idle, working, idle` (Workstream 1) and `error, needs-you, blocked, error, needs-you` (Workstream 2). It asserts each row's glyph and word, that the two `blocked` rows wait on two different open `u356 blocker` Todos, the Workstream 1 row reading `blocked` when collapsed, the Workstream 2 row reading `error`, and `⌘J` visiting the four `error` and `needs-you` Agents and no `blocked` one.

Not captured: the `agent-browser` screenshots and `window.__checks()` at 1280 by 800 and 700 by 800. A collapsed Workstream over `needs-you` but no `error` is not rendered either, as two `error` entries leave none in the ten.
