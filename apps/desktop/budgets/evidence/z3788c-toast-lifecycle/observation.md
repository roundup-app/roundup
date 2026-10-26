Z3788c Toast queue row, Linux/Chromium, 2026-10-26. Base `07cdccb91`; production head `0c5095444883e64bcceb6513a54fbbfb5092732b`.

| Observer | Result |
| --- | --- |
| Toast regression suite | 51 tests pass, including owner disposal/remount on focus and visibilitychange, early listener removal after drain, activation, sound, pause and failure ownership. |
| Real Daemon | Fresh A3564a attention observer passes in 12 s after the cold build; the earlier broad run needed a retry and is not clean evidence. |
| Cleanup mutation | Omitting cleanup fails both new event cases: the retired owner's foreground capability is called once. |
| Dark 1512×950 webview | Twelve paired screens on tree-40, agents-10 and conflict. Queued error appears after return, activation opens agent-3's Terminal, and Daemon-exit text remains visible. All emitted Checks pass, including D2/D5/D6. |
| Input boundary | Six call journals contain no terminal.write calls. |
| Required lints | `just lint-web` and `just lint-rust` exit 0, including proofs; `merge-loss` passes. |
| Production entry closure | 407406 → 407473 gzip bytes, level 9, same host and build settings. The unchanged 437814 ceiling passes. |

The archived Python observer uses a dedicated headless session, fresh profile and the existing Vite harness on localhost:5215 (base) and :5216 (head). It overrides only the fake webview's focus query to hold and release queued attention. It proves neither native focus delivery nor real Daemon execution. The user reports what they meet on the Mac.

`just capture Z3788c` exits 0 with the desktop test script temporarily selecting this observer, then restored. The earlier outer invocation ended with signal 143 after the desktop observer completed; the isolated rerun completed normally. The first setup attempt timed out because the resting App no longer mounts the Rail; the observer explicitly requests the Workstreams view. Media stays uncommitted under artifacts/ux/Z3788c.

This slice changes no layout, controls or motion and preserves the Intervene route. It delivers only the Toast queue inventory row. Remaining Z3788a addons, other Z3788c rows/storage probes and Z3788d measurements stay on #3853. No virtualization or addon byte/memory pass is claimed.
