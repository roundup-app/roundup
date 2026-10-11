# A33 rendered observer

Headless agent-browser (session `a33`) on the dev server of `startRealDaemon` over a real `rupd` with the fake `claude`; `FAKE_CLAUDE_AGENT_TOOLS` makes each Agent create blocker `#1` and a Todo waiting on it, and `FAKE_CLAUDE_ON_PROMPT` readies each Door. One Workstream and one Agent, started by the Rail and renamed `api` so its name leaves room.

`blocked-1280x800.png`, `blocked-700x800.png`: the Agent `api`'s row with the `⏸` glyph. The row's accessible name reads `blocked api waits on #1`, but the Rail clips the `waits on #1` line to `w..` (`.live-label` is 40 px wide of the 94 px it needs at 1280×800), so the captures do not show the line or the word; D5 still passes. That is a Rail layout gap, #881, which blocks #863. `blocked-*.checks.json`: `window.__checks()` for each.

The `a33_` test (`apps/desktop/src/testing/a33_blocked_real_daemon.test.tsx`) asserts the glyph label, the `waits on #1` line and the return to `idle` when `#1` completes, in jsdom.
