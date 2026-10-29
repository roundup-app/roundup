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

Fix verification source: `cd982c2a0` with clean merge of `2bcba5ed7`. The catalogue keeps the existing recording glyph; Settings copy is extracted by surface. The isolated U4277 rendered observer passes after installing the runner's missing ffmpeg. Refreshed head readings show no passing Check regressed; 38 PNG images and the interaction video remain untracked. Catalogue, preferences and recovery suites pass (42 tests).

Final fix validation: `just ready`, TypeScript, targeted lint, trailers, frozen and merge-loss pass. All 16 Settings tests pass with retries disabled after scoping recorder lookups to Settings; together with the 42 catalogue/preferences/recovery tests, 58 behavioral tests pass. No test is removed; the recorder still proves recording state, new-chord invocation and the help chord.

## U4686 categorised Settings

Product baseline: `514edfafcb07396b4eceecba084d1b2d83261396` (full SHA in `base/revision.json`); product head: `3bebc508175f5837e7f43a170c2082b7f9820eb0`. Linux, isolated headless agent-browser, fresh profiles, dark 1512×950. The head observer was also run against baseline product code, selecting its existing Close action where head selects Back.

| Acceptance | Evidence |
| --- | --- |
| U4686a/c | Existing mounted App page observer extended across both category boundaries in both directions, with pointer selection and panel association. Real browser arrows and Tab reach the active page's controls on all five existing seeds. |
| U4686b / P11 | Existing Back/return-focus observer retains Escape. Existing preference observer closes through Back and retains the exact invalid draft across remount without applying it. |
| U4686d | New mounted Settings observer checks accessible descriptions on permission, engine, model, font family, font size, recorder and appearance controls. Existing preference and Terminal observers retain their behavioral proofs. |
| Rendered policy | 24 paired screens: all four pages on tree-40, tabs-8, first-run, agents-10 and conflict, plus recording, refusal, invalid size and failed model listing. Complete cause and recovery text wraps below its group. |
| Checks | D1–D14 and D16 pass in all 24 baseline and 24 head readings. Paired delta has no regression. |

Scoped behavioral verification passes with retries disabled: 16 App Settings tests, 12 preference tests, five Terminal settings tests and the shared-control semantics test. The existing real Tab observer replaces the former simulated focus assertion; no test was removed. The Back test now checks that its original view unmounts, retiring its old copy-assertion exemption. The runner's missing ffmpeg was installed before the passing paired video runs.

Captures use the existing U4277 observer with `ROUNDUP_CAPTURE_SCREENS=settings` and `ROUNDUP_CAPTURES=U4277a`. Images and interaction videos remain untracked. No native macOS observation is claimed; the user reports what they meet on the Mac.

Fix verification: source `4c8e70b4f`, recorded in `fix/revision.json`. The isolated Settings observer passed on all five seeds at 1512×950 in dark mode after installing ffmpeg. Its 24 screenshots, video and Check readings are in `fix/`; comparison with `base/` exits 0 with every previously passing Check retained.
