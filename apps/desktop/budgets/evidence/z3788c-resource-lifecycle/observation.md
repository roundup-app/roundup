Z3788c ResourceStrip visibility row, Linux/Chromium, 2026-10-26. Base `d330caaab7f0881ee57f94597021b05edbf76ba4`; production head `96efce89800a0f31e544d2a83563b524f6c7f325`.

| Observer | Result |
| --- | --- |
| ResourceStrip suite | 14 tests pass: cleanup/remount, polling pause/resume and one in-flight call, original selection, stale responses and recoverable sampling failure. |
| Cleanup mutation | Removing the original listener cleanup fails the new case: one visibility event reads the document twice, including the retired owner. The primitive version reads once; only the current owner resumes polling and disposal releases the final listener. |
| Dark 1512×950 webview | Twelve paired screens on tree-40, agents-10 and conflict. Resources return after visibility change; a failed sample retains the numbers and displays Not updating. Every emitted Check passes, including D2/D5/D6. |
| Real Daemon and continuity | Fresh A3564a passes. Repaired related execution also passes U166, U176 (all ten Agent-name/Rail draft cases), U177 and query reload/caret retention. |
| Required lints | Both pass after the clean merge of main `33eaf811c`, including proofs, type checks and the zero-cycle observer. |
| Input boundary | Six call journals contain zero terminal.write calls. |
| Production entry closure | 407473 → 407463 gzip bytes, level 9, same host/build settings, recursive static imports counted once. Unchanged ceiling 437814 passes. |

`just capture Z3788c` exits 0 with the desktop test script temporarily selecting the archived observer, then restored. It uses a dedicated headless agent-browser session, a fresh profile, and Vite on localhost:5215 (base) / :5216 (head). It overrides only the fake webview visibility capability and sampling failure. Two initial cold-load attempts timed out; the final observer also waits for populated failure text before capturing. Screenshots remain uncommitted under artifacts/ux/Z3788c. Run the archived observer with Z3788_REPO pointing to its checkout after starting the two servers.

Two duplicate tests were cut: `u444_a_missing_value_hides_with_its_icon` retains null-disk coverage, and `u408_other_selections_are_empty_and_make_no_calls` retains the non-working selection case.

Reuse: installed event-listener 2.4.6 directly owns document cleanup. Its registry release is 2026-07-04. react-use 17.6.1 (2026-06-10) was considered; useEvent requires a React effect dispatcher and cannot bind a Solid owner. The native EventTarget installation/removal pair is deleted. No wrapper or dependency is added.

This slice changes no layout, control, motion or draft owner. It completes only the ResourceStrip inventory row. Remaining Terminal addons, other lifecycle rows/storage probes and virtualization measurements stay on #3853. No native timing, addon byte/memory or full-wave completion claim is made. The user reports what they meet on the Mac.

Initial related execution failed to launch its Daemon after the cold Cargo build: the fixture expects binaries in the checkout target/debug, while CARGO_TARGET_DIR pointed to the shared build. It left occupied test slots. This run stopped its own test processes, released their slots and linked the checkout debug directory to the built binaries. Fresh A3564a passes after that setup repair; no timeout or test changed. The repaired broad related run passed 58 completed files (702 tests) with no failures reported before this run stopped it at its time limit; no complete related-suite pass is claimed. CI judges the complete pushed head.
