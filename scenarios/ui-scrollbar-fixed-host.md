# UI: A bar stays on the edge of a fixed or transformed scroll host (U7570a)

Module: `apps/desktop` (the webview). Id: U7570a. Work order: [#7570](https://github.com/roundup-app/roundup/issues/7570).

Extends U7543a to a scroll host whose slot containing block is not its `offsetParent`.

**U7570a the bar sits on the host's edge whatever the host's containing block.** Given a scroll host that is itself `position: fixed`, or sits in a transformed ancestor, with a slot placed by `place` in `apps/desktop/src/scrollHover.ts`, when the host is tracked and then moves or scrolls, then the slot's box equals the host's client box (`clientLeft`/`clientTop` inside its border box, `clientWidth` by `clientHeight`), so the thumb lies on the host's edge. The slot's position never comes from the host's `offsetLeft` or `offsetTop`. Test `u7570a_bar_stays_on_edge_of_fixed_or_transformed_host` (Vitest, in `apps/desktop/src/scrollHover.test.ts`, with the host's and slot's `getBoundingClientRect` stubbed to a fixed host whose `offsetParent` differs from the slot's containing block) asserts the slot's `left`, `top`, `width` and `height`; it fails if `place` positions from `offsetLeft` or `offsetTop`. No such host exists in the App today, so no rendered observer is commissioned (rule 10).

Checks moved (policy): none. Scope: `apps/desktop/src/scrollHover.ts` and its test.
