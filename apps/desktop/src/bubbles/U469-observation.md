# U469 Terminal bar observation

Rebuilt from PR #1572's exhausted head `8fbec361`, merged with main `c8194f26`.

```text
[Terminal ×] [Terminal ×] [+ Terminal]  Resource use | Shelf
```

The inherited repair places the resource column before the open Shelf and gives the add control its visible `+ Terminal` label and accessible `New Terminal` name. Both rendered regression tests pass at 1280×800 and 1440×800 in light and dark. All 120 Bubble and Resource tests pass, including U164, U165, U421, U444 and U469.

Baseline main `c8194f26`: `bubbles` (runner selected), `door-stopped`, `resources`, `tree-40`, `first-run`, `conflict` and `agents-10`, at both viewports and schemes. Every Check passed in all 28 states; no pre-existing Check failure was observed. The baseline used a dedicated headless agent-browser session with a fresh profile.

Regenerate the head's required capture payload with `just capture U469`. U469 captures include bar/composer/pane rectangles, focused element, visible Bubble ids, RPC counts and Checks for opening, switching, minimising, Pull, closing, rejected calls, selection and missing selection. Publication belongs to the pushed head and remains required before review. The user reports what they meet on the Mac.
