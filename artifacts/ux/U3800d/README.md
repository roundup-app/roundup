# U3800d Observer

Headless Chromium 156.0.8078.0, fresh profile, dark, 1512×950, `tree-40` on `just harness` (Vite dev server, software rendering). 10 Rail drops (`tokens` below `logins`, then back), CDP `Tracing` (`devtools.timeline`, `blink.user_timing`). Release is a `performance.mark` on `pointerup`; the end is two frames after `rail.move` was called and the drag placeholder is gone. A Shift keydown is sent 20 ms after the release.

| Run | Longest task, release to end (min / median / max) | Keydown to next paint (median / max) |
|---|---|---|
| `main` @ `a66dafe73` (`main.json`) | 446 / 472 / 537 ms | 27 / 42 ms |
| head, PR #6350 + `main` (`head.json`) | 252 / 273 / 299 ms | 22 / 28 ms |

Both are far over 16.7 ms; U3800d is not met. The head is 40% shorter than `main` (the KindGlyph early return and the `byKey` reuse help).

Cause on the head, from the trace of one drop: the longest task is one `EventDispatch` of 258 ms (the `pointerup`), holding a 69 ms dnd-kit call, many sub-3 ms Solid and Ark TreeView calls (`mergeProps`, `getNodeState`, `visit`, `getIndexPath` over the whole collection) and 40 ms of forced layout. 39 elements are added per drop (4 nodes of the moved row), so the cost is the reactive recalculation of the whole tree, not remounts: `u3800d_a_move_keeps_the_other_rows` is not warranted. `scrollHover.ts` re-walks the mutated parent's subtree with `getComputedStyle` (about 78 ms of calls per drop); scanning only the added nodes cut that to 41 ms but did not change the longest task (median 279 ms, `head-scroll.json`), so it was not kept.
