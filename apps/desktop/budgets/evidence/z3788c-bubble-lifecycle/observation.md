Z3788c Bubble lifecycle slice, Linux/Chromium, 2026-10-26.

| Observer | Result |
| --- | --- |
| Owner cleanup mutation | Replacing makeResizeObserver with an unowned native observer makes z3788c_only_the_current_bubble_owner_refits_after_remount fail: a disposed Bubble recreates Terminal work. The library cleanup is restored. |
| Focused behavior | All 46 tests pass across u164_surfaces, u164_bubbles, u2236_resize and u2307_panel. Existing cancellation, frame coalescing, input isolation, selection, focus and reload observers remain. |
| Production startup | Same-host recursive static closure: 407588 → 407627 gzip bytes, below unchanged 437814 ceiling. Python gzip level 9, mtime 0; each file counted once. Both production builds exit 0. |

Installed event-listener 2.4.6 and resize-observer 2.2.0 directly replace Bubble's AbortController, five listener registrations and observer cleanup. makeEventListenerStack lives under the existing component owner; finish clears it before releasing pointer capture. The existing callbacks, capture option, pointer identity checks, cancellation, pending-frame cancellation and early stop remain. There is no adapter or new dependency. Native EventTarget and ResizeObserver already provide events; the selected primitives own their lifetime. The library callback stack clears completed removals rather than retaining past gestures.

Reuse evidence: the npm registry records event-listener 2.4.6 on July 4, 2026. The maintained Solid Primitives packages provide both owner cleanup and early disposal. react-use 17.6.1, released June 10, 2026, offers useEvent/useMeasure but requires React effect ownership and cannot bind this Solid owner. Primary source and releases are linked in the PR.

The removed u164_the_bubble_layer_floats_over_the_stack checks only parent placement. u164_a_bubble_floats_over_the_pane_and_adds_no_rail_row_or_switcher_entry retains the U164 surface proof; the rendered observer covers placement. The new test counts actual fit work and catches a disposed owner's resurrection, which the existing geometry and reload tests do not observe.

P1/P9 require zero Terminal input writes from navigation; P3 keeps native attention reachable; P11 preserves existing input and original identities. D2/D5/D6 remain required. No layout or motion is changed. Addons, cutTitle, storage capability probes and virtualization measurements remain on #3853. This slice claims no Terminal-addon compatibility, memory or no-growth pass and no native timing. The user reports what they meet on the Mac.

The archived observer starts independent base/head Vite servers on 5215/5216 and uses a dedicated headless agent-browser session and fresh profile. Set Z3788_REPO to the checkout. Dark 1512×950 paired screens cover tree-40, agents-10 and conflict, Bubble opening, keyboard refitting, pointer movement and visible resize failure. Media stays uncommitted under artifacts/ux/Z3788c. The initial cold navigation failed; the isolated observer then completed. Another setup selected an Agent before its Terminal finished taking focus and the new Bubble folded; the final observer opens from the overview. An earlier failure observer waited for connection text not rendered on that path; the final one injects the resize failure owned by Bubble.

The first focused execution overlapped a temporary package-script write and two files could not read package.json. The package file is restored and the fresh focused run passes all 46 tests. The initial production build overlapped a mutation and is discarded; paired.json uses untouched main and the restored library implementation. No timeout or test was weakened.

The final `just capture Z3788c` exits 0 with pointer movement and output in the observer. All twelve dark screens pass every emitted Check, including D2/D5/D6; the six journals contain zero Terminal input writes. The resize failure remains fully visible. Screens show the same existing bottom-row output clipping on main and head; no new clipping is claimed resolved.

The first complete lint invocations ended with signal 143 after web type checking and Rust proof-mutation checks. Fresh complete reruns are in progress; those interrupted invocations are not counted as passes. The broad related run is still incomplete and initially waited for the cold Cargo build. CI judges the full pushed head.
