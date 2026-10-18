# Selection repair

Observer: isolated headless Chromium, agent-browser session `builder-39159489079`, fresh `/tmp/2695-observer` profile, 1512×950, fake-Daemon harness, DOM renderer. Base: `7d78b2fd66bb4e9bb1f11c201d059dcf7a5a4bc0`. Head: `5b8cd8fb7` (the repair merged with current main).

| Capture | Result |
| --- | --- |
| `dense-light`, `dense-dark-failure` | D6/D7/D10 fixed; all other Checks remain passing. The failed Terminal creation remains visible. |
| `pad-drag` | Dragging read-only `pad-0`, owned by `agent-1`, selects `some te`; baseline selects nothing. D1/D2/D6/D7/D10 retain the same failures from the editor stylesheet and link control. |
| `decision-drag` | Dragging the permission command selects `rm -rf bu`; baseline selects nothing. All Checks remain passing. |

Each pair includes the screenshot and complete Check readings. Selection JSON records the drag's selected text. `loop/rules.sh delta artifacts/ux/U2680/base artifacts/ux/U2680/head` reports no regression. The `u2680c_readonly_content_keeps_native_selection_and_copy` browser cases additionally copy the selected text and paste it into an input, asserting equality; both failed before the CSS repair and pass after it.
