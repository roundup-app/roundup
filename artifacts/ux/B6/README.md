# B6 held rename observer

Source: `a5e62528d`, including main `c94ff5bde`. Real Daemon, fake Claude,
headless Chromium in a fresh test profile and a test-owned Project.

| Viewport | Watch | Take control + queued rename | Give control back |
| --- | --- | --- | --- |
| 1280×800 | `rename-1280-watch.png` | `rename-1280-held.png` | `rename-1280-released.png` |
| 1440×800 | `rename-1440-watch.png` | `rename-1440-held.png` | `rename-1440-released.png` |

Each adjacent `.checks.json` reports D1–D10 passing. During control, a Door
RPC caller receives a durable waiting receipt and the old name remains visible.
Giving control back applies the queued name; the observer waits for that name
in the rendered Watching line before capturing the result. `rename-actions.json`
retains both completed receipts. The run's browser, server and Daemon are closed.

## Held Stop observer

Source: `5722d35c6`, including main `3ae35ad08`. Real Daemon, fake Claude,
isolated Project, and a fresh headless
Chromium profile. The test-owned browser, Vite and Daemon are closed.

At 1280×800 and 1440×800, `stop-<width>-watch.png`, `stop-<width>-held.png`
and `stop-<width>-released.png` show Watch → Take control → Give control back.
Every adjacent Checks file reports D1–D10 passing. During control, the Door's
Stop returns a waiting receipt and the original Terminal stays running. Giving
control back stops that Terminal; `stop-actions.json` retains both completed
receipts. These captures establish Chromium behavior, not native macOS behavior.
