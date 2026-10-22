# UI: The window never moves as a whole (U3785, U3786)

Module: `apps/desktop` (the webview). Ids: U3785, U3786. Work order: [#3318](https://github.com/saadshahd/roundup/issues/3318). The owner's words: scrolling to the end of a scrollbar moves the outside app layout, in both directions, even the tab strip; it does not feel like a native app.

**U3785 scrolling past an area's end moves nothing else.** Given any scroll area of the App (a Terminal's scrollback, the Rail, a Pad, a list, a Dialog), when the user scrolls past its first or last line, then the area stops at its end and the tab strip, Rail and Shelf do not move, scroll or bounce.

1. *The window is fixed.* `html`, `body` and `#root` compute `overflow: hidden` and `overscroll-behavior: none`.
2. *Each area keeps its scroll.* Every element that scrolls (`overflow`, `overflow-x` or `overflow-y` of `auto` or `scroll`), the xterm viewport included, computes `overscroll-behavior: contain` or `none`, so reaching its end passes the scroll on to no ancestor.
3. *Still scrolls.* Nested scroll areas scroll on their own, the Terminal keeps its scrollback and wheel handling (U34), and U3747 scrollbars keep their look.

Test: `u3785_window_and_scroll_areas_hold_their_overscroll` (`apps/desktop/src/u3785_overscroll.test.ts`: reads the computed styles in the U26 harness at 1280 by 800 on the `tree-40` and `agents-10` seeds, and a wheel past the end of a Terminal's scrollback leaves `scrollingElement.scrollTop` and the tab strip's box at 0). Moves: D2, D5, D6. Regression: U34, U3747.

**U3786 a stylesheet cannot add a scroll area that leaks its scroll.** Given a CSS rule under `apps/desktop/src` that declares `overflow`, `overflow-x` or `overflow-y` as `auto` or `scroll`, then it also declares `overscroll-behavior`, or `just lint-web` fails naming the rule. Test: `u3786_scroll_rule_declares_overscroll` (a stylelint check in `stylelint.config.mjs`, run by `lint:styles`; no browser). Regression: U3785.
