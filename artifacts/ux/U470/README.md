# U470

```text
Todos · Pads · [shared scope] · [hide arrow]
```

| Before | After | Why |
| --- | --- | --- |
| [Todos: segmented control](base/1280x800-light-todos-false.png) | [Todos: header toggle](head/1280x800-light-todos-false.png) | One scope choice beside the hide arrow |
| [Pads: no scope control](base/1280x800-light-pads-false.png) | [Pads: same header toggle](head/1280x800-light-pads-false.png) | Both lists expose their shared scope |

The committed baseline is main `111b4b79`. The refreshed head captures include main `9a51d2b6` and the critic repair: Lucide `list-filter` stays unchanged in both scope states; the pressed toggle takes `--selected`, hover takes `--selected-hover`, and pointerdown takes `--pressed`. No other screen uses this mark. The stale U368 group styles and design-system wording are removed.

An isolated headless agent-browser session with a fresh profile drives tree-40 at 1280×800 and 1440×800, light and dark, normal and increased contrast. Each Workstream has an open Todo and Pad; Project-root items, a 300-character Todo title and a 120-character Pad name remain in the seed.

There are 32 matching main/head states and 24 head interaction states: 88 PNG/checks pairs. Every reading passes D1–D14 and D16. `loop/rules.sh delta artifacts/ux/U470/base artifacts/ux/U470/head` exits 0: all 448 comparisons stay passing. The mark is 16 px; both controls are 24 px square, share a vertical centre within 1 px, and fit with the labels/counts without overlap or overflow.

Space and Enter produce exactly two clicks and two non-repeated keydowns, retain scope-button focus, and Tab reaches Hide Shelf next. The press capture asserts `:active`; [the dense failure](interaction/1280x800-dark-failure.png) keeps its completion error visible. Component observers cover both lists/counts, root items, row-selection reset, visibility and hide/reopen lifetime.

Captures are written by `ROUNDUP_U470_MAIN=<baseline checkout>/apps/desktop VITEST_MAX_WORKERS=2 just capture U470`. This observes the webview on a fake Daemon; the user reports what they meet on the Mac.

A separate isolated run against current main `9a51d2b6` passes both rendered U470 tests: all 32 matched states keep every passing Check, and native Tab, Space and Enter work. The committed historical baseline/head delta also exits 0.
