# U4274a–c connected navigation observation

Baseline: `a8912caabbcc030532a946473b924974d782632c`
Head: `993448487` (navigation implementation).

Isolated headless agent-browser sessions, fresh temporary profiles, dark mode, 1512×950. The browser observes the webview and traffic-light reservation, not native macOS gestures.

| State | Observation |
|---|---|
| empty-project | Head mounts Project tabs in WindowBar and the Rail at rest; no empty Terminal strip. |
| tree-40 | Direct navigation stays visible; New Terminal opens a shell Bubble. A rejected open exposes the complete cause and retry instruction. |
| tabs-8 | WindowBar retains the Project tablist and overflow. |
| bubbles | Existing minimised/exited Terminals retain eligible tabs. New Terminal opens directly. |
| dense-long-names-shelf | Long Project/Terminal names with Shelf open preserve primary navigation. |
| dense-drawer | Drawer opens alongside the retained Rail and native-bar tabs. |

Every paired reading passes D2, D5 and D6; no Check passing on the baseline regresses. `loop/rules.sh delta` exits 0. Paired screenshots and interaction videos are left under `artifacts/ux/U4274{a,b,c}/{base,head}` and are not committed. The design critic independently judges their placement, clipping and failure readability.

The broad `just capture U4274a,U4274b,U4274c` starts every workspace test. It was stopped to keep this run bounded; it is not counted as a passing test run. The isolated paired observer above completed separately. CI owns the full suite.
