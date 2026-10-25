# U131 shared row inset

Acceptance: `scenarios/ui-visual.md`, “U131 row alignment extension (D8)”.
Continuation of #3948; #4005 already merged its row-state and pointer-focus
repairs. This slice owns the Shelf and Terminal-tab inset. Rail alignment and
the optical baseline measurement remain acceptance on #3824.

## Baseline

Main `6caf136e5e939f4694f436e40e9331c4727af1e4`, isolated headless Chromium,
dark, 1512×950, device scale 1. On `tree-40`, open the Overview's Unassigned
group. Measure each title from its own row edge, subtracting only
`(aria-level - 1) × 16` for the existing Todo tree indent.

| Before | Required after |
| --- | --- |
| Plain Todo title: 32 CSS px | One shared inset |
| Blocked Todo title: 56 CSS px after tree indent | Same inset with room for tick and blocker mark |
| Entry title: 56 CSS px | Same inset with empty slots reserved |
| Pad and Terminal names use separate geometry | Read the shared Token, including Terminal rename |

The change reserves the existing blocker row's leading space. It keeps the
tick-only Todo and its native target, the blocker mark and tree indentation.
Paint and geometry are critic observations; existing behavioral tests cover
Todo completion, Pad opening and Terminal selection/rename.
