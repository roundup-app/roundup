# U134/U135 native material Builder evidence

Implementation source: `63b100b84` on branch `build/design-system-native-material`, main reference `2b45d05dbd982ea9f8d9ed529bd7e4d9a9838dae`. Linux Chromium, dark, 1512×950, isolated profile `native-40301653424`.

Five paired screens (`first-run`, `agents-10`, `tree-40`, `daemon-exits`, `conflict`) pass D1–D14 and D16. The harness only imports the changed Token stylesheet; its baseline used that stylesheet from the main reference, with the same renderer/profile/seed. Head also has expanded/selected Shelf PNGs and an interaction video. Drawer, menu and Terminal captures still need completion. Images/videos remain uncommitted. U134's five paired readings equal main's existing readings; U135 retains this run's readings. Full-directory U134 delta exits 2 because main has an unmatched `capture-panel-disabled-purple` head reading; the five named pairs and U135 delta have no regression.

13 preference/window tests pass (`material.test.ts`, `u135_schemes.test.tsx`, `u450_window.test.ts`), including native-state delivery, unsupported fallback, reduced transparency and system accent changes. All 54 `u137_checks.test.tsx` tests pass. Rust lint passes, including ALL PROOFS CHECK. The initial web lint found material payload parsing and selector-count violations; both were repaired and focused source/style lints pass. The remaining web lint phases passed.

No native rendering or App launch timing result is claimed. Per #4072's current acceptance, the owner observes the merged App once on the Mac; that observation does not gate this Linux implementation.

Pending at evidence recording: desktop window/capability Rust tests pass (3 tests); unchanged `just perf` is building its same-host main reference. The broad related-test run hit `a3564a_attention_opens_the_requesting_terminal`'s 240 s setup timeout during concurrent compilation; it needs an isolated rerun after the build. `just capture U134,U135` was started and interrupted before the full suite finished to free this Builder for the required Rust/perf checks. No full-suite or perf pass is claimed. Issue #4072 stays open until these remaining observations succeed.
