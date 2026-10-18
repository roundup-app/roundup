# Continued selection repair

Head observed: `8a790bd42688195b722175cfeae665fdf24b395e`, continuing #2695's final head and merging main `470b80173`. Isolated headless Chromium, agent-browser session `builder-39162547663`, fresh `/tmp/2680-observer` profile, fake Daemon with DOM renderer, 1512×950. The session was closed after capture.

| Capture | Observation |
| --- | --- |
| `dense-light` | All automated Checks pass. |
| `dense-dark-failure` | All automated Checks pass; failed Terminal creation displays `selection observer failure`. |
| `pad-drag` | Read-only Pad `pad-0` selects `some te` through a mouse drag. |
| `decision-drag` | Permission command selects `rm -rf bu` through a mouse drag. |

The earlier `base`/`head` pairs retain the red/green evidence for the CSS repair and have no Check regression (`loop/rules.sh delta`). This continuation changes no selection implementation or visual design. Browser regression cases separately check copying and pasting the selected content.

WebKit is not available through installed agent-browser 0.27.0 (only Chrome and Lightpanda engines). These captures make no WebKit, full real-WebGL matrix or native macOS claim. Issue #2680 stays open for the remaining observer matrix; the user reports what they meet on the Mac.

Validation: 105 focused Chromium browser tests pass; the isolated real-zsh/WebGL Bubble observer passes with exit 0. The related run covers 1,366 tests in 178 files: its three failures and three skipped tests came from five files with cold-build/setup, browser-navigation or observer timeouts. All five files pass on targeted rerun without changing code or timeouts; `validation.json` records the counts and file names. Main advanced only scenario documents to `26b057cde`; the clean merge changes no observed App source.
