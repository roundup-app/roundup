# U4275b rendered observation

Continuation of #4352, merged with main `691c6e43c`. Baseline images use `ce308a653`. Dedicated headless Chromium sessions, temporary profiles, 1512×950, dark.

| Before | After |
| --- | --- |
| Hidden actions consume the name column and can push Open beyond the Rail | Main’s trailing overlay preserves resting names and keeps the whole action group inside the Rail |

The Rail stylesheet equals main. On the ordinary tree, backend, auth-refactor and token-rotation are readable at rest. Focused backend and the long-name Workstream have pointer-reachable Add Agent, Clear, folder, editor and Open; Open ends at x=271 within the x=288 Rail. The screen’s Checks pass.

Fresh tree-40 images cover rest, hover, focus, selection, nested Todos and visible folder-failure feedback. Their saved Checks pass, including D2, D5 and D6. Images remain untracked. Historical geometry files identify their earlier observations; the fresh paired readings supersede them.

The combined baseline/head capture hit its unchanged 300-second limit. The separate head capture completed the tree images but `agent-browser record stop` exited 1; no finalized video is claimed. The ordinary capture observer is also run without recording. The title observer hit its unchanged 15-second limit under concurrent compilation. These are observer limits, not claimed passes.

Fresh Linux desktop build: exit 0, zero `Modifiers::SUPER` diagnostics. Cargo tree resolves crates.io global-hotkey 0.9.0. Unchanged shortcut web tests: 27 pass. The same dependency replacement passed #4352’s fresh macOS build and native shortcut lane. This head retains both CI observers; no manual Mac observation is needed.
