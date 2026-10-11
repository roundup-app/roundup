# U351 rendered observer

Headless agent-browser (session `u351`) on `just harness-real` (U144) over a real `rupd` started with `FAKE_CLAUDE_KINDS` of `working, idle, needs-you, working, idle` (Workstream 1) and `error, needs-you, working, error, needs-you` (Workstream 2), and `FAKE_CLAUDE_ON_PROMPT` so each Door is ready. Each Workstream's five Agents were started by `+ agent`.

`kinds-1280x800.png`, `kinds-700x800.png`: the Rail with ten Agents, each row with its glyph and, for `error` and `needs-you`, its word. `kinds-*.checks.json`: `window.__checks()` for each; D1, D6, D7 and D10 fail on the Terminal's `div.xterm-scrollable-element` and `textarea.xterm-helper-textarea` (filed as #836), every other Check passes.

The `u351_` test (`apps/desktop/src/testing/u351_kinds_real_daemon.test.tsx`) asserts each row's glyph and word, the collapsed Workstream rows (`needs-you`, `error`), a quiet `working` Agent, and `⌘J` in order (`error`, then `needs-you`, by age) with its wrap.
