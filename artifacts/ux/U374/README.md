# U374 rewind prompt

The isolated headless observer in `apps/desktop/src/thread/u374_rendered.test.ts` drives plan → files → pending → result → failure at 1280×800 and 1440×800, in light and dark. It checks that controls stay visible together, Agent names stay beside their state, paths have no inner scroll, and leading dots and underscores remain before the path. Captures come from `just capture A35,U374`.

Against main `b5b51f34`, the 1280×800 light/dark observers for agents-10, tree-40, first-run, thread-report and decisions introduced no D1, D2, D5, D6 or D8 regression (20 screens across main and head).

The fake seam proves the webview. A35’s real-Daemon tests prove rewind behavior with the deterministic fake Claude. The real-Claude Mac observation is still required; #808 stays open.
