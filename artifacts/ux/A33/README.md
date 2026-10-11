# A33 rendered observer

Headless agent-browser (session `a33`) on the dev server of `startRealDaemon` over a real `rupd` with the fake `claude`; `FAKE_CLAUDE_AGENT_TOOLS` makes each Agent create blocker `#1` and a Todo waiting on it, and `FAKE_CLAUDE_ON_PROMPT` readies each Door. One Workstream and one `agent` row, started by the Rail.

`blocked-1280x800.png`, `blocked-700x800.png`: the Agent's row with the `⏸` glyph, the word `blocked` and the line `waits on #1`. `blocked-*.checks.json`: `window.__checks()` for each; every Check passes.

The `a33_` test (`apps/desktop/src/testing/a33_blocked_real_daemon.test.tsx`) asserts the glyph label, the `waits on #1` line and the return to `idle` when `#1` completes.
