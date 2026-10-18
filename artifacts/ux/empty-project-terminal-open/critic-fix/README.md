# Critic repair

Moves: D2, D5, D6. The design-system Checks and Tokens are unchanged.

| Before | After | Observer |
| --- | --- | --- |
| Project Bubble cuts the first Workstream action in half | The empty pane placeholder is hidden while the root Bubble is shown | `base/open-light.png`, `head/empty-project-*-retry.png` |
| A rejected open leaves focus on BODY | `+ Terminal` regains focus and Enter retries | `head/empty-project-*-failure.json`, `head/empty-project-*-retry.json` |
| Failure appears at the pane's top-right | Failure appears above the bottom bar, at its leading edge | `head/*-failure.png` |

Linux Chromium, isolated headless agent-browser session `builder-39104794630`, fresh profile, 1512×950, U26 fake App. Each theme records before, rejected open, and keyboard retry for empty-project and tree-40. The original real-Daemon lifecycle evidence in the parent directory still covers Terminal ownership; this repair changes presentation and focus only.

`summary.json` records every non-passing Check. Empty Project passes every Check in both schemes. The dense seed retains D6/D7/D10 on Todo controls, as the critic observed on main; failure text remains visible in both themes. In retry records the pane placeholder has `display: none`, and in failure records the active element is `New Terminal`.

The existing `u524_a_failed_empty_project_open_can_be_retried` test now asserts failure focus. It failed before the repair and passes afterward. The other tests in its file cover distinct inputs or branches; no redundant test was found to cut.

The critic's optional Terminal-move idea adds an ownership workflow beyond this repair and is not implemented. The user reports what they meet on the Mac.
