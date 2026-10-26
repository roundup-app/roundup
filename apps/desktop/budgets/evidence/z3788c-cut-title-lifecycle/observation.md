Z3788c cutTitle row, Linux/Chromium, 2026-10-26. Production source `8961c7a08`; base App source `3707a2c4e` equals `a8912caab` under apps/desktop.

| Observer | Result |
| --- | --- |
| Target and owner lifecycle | New observer in existing U2228a suite releases the previous primary and extra targets; only the current owner measures once after disposal/remount, and no owner measures after final disposal. |
| Cleanup mutation | Removing the old disconnect cleanup fails the new test: notifications from released targets cause three measurements instead of zero. Original and primitive versions pass. |
| Focused regression | All 42 tests in six touched suites pass without retries: native title behavior, rename and clear recovery, original recipients/revisions, selection/focus and splitter cancellation. |
| Production bytes | Same-host recursive static closure, Python gzip level 9: 407627 → 407831 bytes; raw 1279306 → 1279804. Installed startup observer separately reports 408850 gzip bytes, below unchanged 437814 ceiling. These use different gzip implementations; only like-for-like totals are compared. |

Installed resize-observer 2.2.0 directly owns observer disposal and diffs reactive primary/extra targets. It was published 2026-07-05 and supports installed Solid 1.9.17 through peer ^1.6.12. Installed event-listener 2.4.6 (2026-07-04) cannot deliver ResizeObserver geometry callbacks from EventTarget. The installed implementation and browser ResizeObserver were inspected before writing. No wrapper, dependency or title measurement change is introduced. Exact registry evidence is in libraries.json.

The five older observer fixtures now supply the browser's unobserve method, required by the library even before targets change. Their test bodies and behavioral proofs remain. No duplicate/compiler-only test was added; the new lifecycle test observes measurement call counts through a browser boundary, not layout values. Existing U2228a native-title contracts remain separate from the new lifecycle proof.

P3: current attention and native-title ownership remain; P11: existing draft/revision/selection owners remain. D2/D5/D6 are regression checks only. No excluded #3742 file, contract, scenario, appearance exemption or loop machinery changes. Terminal addons, placesStorage's capability decision and valid virtualization measurements remain on #3853. No native timing, addon memory/byte or full-wave completion claim is made. The user reports what they meet on the Mac.
