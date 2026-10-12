# Native prerequisite for the window bar

Issue #1259; parent #1104. This Linux run tests only native configuration and the App adapter. It makes no Mac placement, traffic-light interaction, Window menu, Mission Control, drag or zoom observation claim.

`u449_window_configuration_uses_one_title_row` passes against the compiled Tauri configuration. `u450_native_setter_receives_the_full_text` and the adapter's drag, zoom and failure cases pass. Real-capability IPC probes accept the three operations and reject core commands that select a window; the current-window commands ignore a supplied target label. Fake tests record operations, rejection and reverse completion of pending writes. The served-browser operations leave the host window and Daemon untouched.

[Performance report](perf.json): `just perf` exited 1. Cold start was 89.600 ms (limit 300); extra RSS was 3.031 MB (limit 150), failing the committed Linux regression ceiling of 1.810 MB. Four latency comparisons were explicitly skipped for load. These are Daemon metrics, not native rendering measurements.

Issue #1251 already records this Linux observer failure on main and owns its repair. This PR changes no release Daemon or performance-observer source. #1259 is blocked by #1251; #1104 retains header layout, title synchronization and native Mac policy observation.

Final validation: `just check` exits 0 with 1,456 Rust tests and 2,235 web tests passing, plus proofs, lint, type checking and slop. This includes the shared title-write control of Project-bound fake callers. `just perf` remains the separately recorded blocker above.
