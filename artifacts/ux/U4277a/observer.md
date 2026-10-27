# U4277 Settings and recovery observation

Source: `7e9d1dd7c8fbb499970d8f35a408efdf4326a078`; baseline: `120b9d3f9` (origin/main, including #4289). Linux, isolated headless agent-browser sessions and fresh profiles, 1512×950, dark only.

| Observer | Result |
| --- | --- |
| Settings on tree-40, tabs-8, first-run, agents-10 and conflict | All four sections remain available after real pointer selection and Tab into the panel. Captures include invalid size, shortcut recording and shortcut refusal. |
| Empty and filled recovery | Compact empty surface; retained text wraps; one Copy per item, unfilled actions, continuous header/action ground and no recovery title outside the surface. |
| Other six requested screens | Empty/filled audit plus Import partial failure retained under U4277c. Deferred repairs remain #4297. |
| D1–D14 and D16 | All pass in 23 Settings, two recovery and 13 other-screen head readings; paired delta reports no regression. |
| Behavioral checks | 16 Settings tests, 11 preference tests and 28 recovery tests pass; one unrelated capture test is opt-in. U4277's targeted rendered capture observer passes. |
| Required checks | `just ready` and `loop/rules.sh merge-loss` pass. |

PNG/video payloads remain untracked under each scenario's `base/` and `head/`. Baseline Settings has no section tabs; its named section captures show the original combined form.

Increased-contrast observation is unavailable through this agent-browser setup: fresh Chromium 156 launches with `--force-high-contrast,--disable-blink-features=ForcedColors` still report `matchMedia('(prefers-contrast: more)').matches === false`. Those attempts produce no claimed increased-contrast capture. The changed surfaces retain their existing contrast Tokens.

Fix verification source: `cd982c2a0` with clean merge of `2bcba5ed7`. The catalogue keeps the existing recording glyph; Settings copy is extracted by surface. The isolated U4277 rendered observer passes after installing the runner's missing ffmpeg. Refreshed head readings show no passing Check regressed; 38 PNGs and the interaction video remain untracked. Catalogue, preferences and recovery suites pass (42 tests).
