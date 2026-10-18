# U524 / X12: Terminal before the first Workstream

Implementation: `ed9e846031bd4fa2fb251039cd188edd834e4315`.
Final lifecycle observer: `590f0d4f2`; clean main merge: `33dfa8aa3`.

Linux, isolated headless `agent-browser` session `builder-39099749878`, fresh browser profile, 1512×950. The U144 harness relayed to this run's real `rupd --attached`, with separate temporary Project, data and socket paths. Its login shell was `/tmp/2633-shell`, a symlink to `/bin/sh`; no Agent was started.

| Interaction | Evidence | Result |
| --- | --- | --- |
| Empty Project, ⌘T | `open.result.json`, `open.png` | One `terminal.open {workstream: null}`, Bubble 4 owns input focus; no create-Workstream or start-Door call |
| Shell executable removed, ⌘T | `failure.result.json`, `failure.png` | Real Daemon error `cannot run /tmp/2633-shell` remains visible; no Bubble |
| Executable restored, ⌘T | `retry.result.json`, `retry.png` | One retry opens Bubble 2 and focuses it; failure clears |
| Reload webview | `reload.result.json` | Existing Project-owned Terminal remains available without another open |
| Close through the tab | `cleanup.result.json` | Real `terminal.list` and `rail.tree` both return `[]` |
| Open by `+` in dark | `dark.result.json`, `dark.png` | Bubble 3 owns input focus |
| Densest seed, rejected open | `head/dense-light.png`, `head/dense-dark.png` | Fake U26 `tree-40` shows failure text in both schemes |

Every empty-Project capture passes D1–D14 and D16, including the moved D2, D5 and D6. On `tree-40`, both this head and an independently rendered `origin/main` (`f1759e816`) fail D6 (missing hover) and D7 (non-instant press) on `input.todo-tick`; D10 reflects those failures. Their failing Check records match exactly in light and dark (`base/dense-*` and `head/dense-*`); no new failure is introduced. `before.png` shows the empty Project before opening. The dense-seed check uses the fake App; the empty-Project actions use the real Daemon and shell.

The obsolete empty-Project no-call test is replaced by `u524_an_empty_project_opens_and_focuses_a_project_terminal`; its selection-message lifetime clause is retired and the failure/retry observer remains. The standalone `x12_a_connection_ending_closes_nothing` test is consolidated into `x12_a_real_daemon_opens_writes_reads_back_and_closes_a_terminal`, retaining the list-after-reconnect assertion for both ownership forms. The remaining edited-file tests cover distinct behavior.

These observations cover Chromium and Linux. The user reports what they meet on the Mac.
