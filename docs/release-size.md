# C9 release reduction in progress (#3807)

Reference: `7ef5cb4b09f1cd90ea141dec5f185fd0adeedaa9`; measured implementation:
`0ee9f45d4b81bf4cc7f77b71f8f6b6be4e645a48`. Ubuntu 24.04.5, AMD EPYC 7763,
four available CPUs; rustc 1.99.0 (`b940084d7eb6a299eb4bfeb8e34901bc051e7ac4`),
x86_64-unknown-linux-gnu, LLVM 23.1.1, Node 22.23.3, pnpm 10.14.0.

| Uncompressed artifact | Reference | Implementation | Exclusive cap |
|---|---:|---:|---:|
| Complete desktop dist, logical bytes | 27,673,763 | 18,961,207 | 10,000,000 |
| Regular files / JS files | 738 / 665 | 487 / 414 | — |
| Native release rupd | 26,163,328 | build pending | 15,000,000 |

Both production desktop builds exited 0. Reproduce with
`pnpm install --frozen-lockfile`, `pnpm --filter desktop build`,
`du -sh apps/desktop/dist`, `find apps/desktop/dist -name '*.js' | wc -l`, and
`python3 tools/release/check.py dist apps/desktop/dist` (exit 1 for both measured trees).
`du -sh` reported 28M on the reference; logical lengths, rather than disk allocation,
determine the gate. The checker recursively includes every asset and refuses symlinks,
special files, missing/empty output and unreadable files. Its six command tests cover
exact byte boundaries and invalid inputs. CI's native Linux/macOS and desktop lanes
feed the required `check`; selected failures and cancellations cannot pass.

The installed Pierre Diff reader explicitly selects Highlights. Its backend supplies
bundled lexers and plain-text fallback; the Pad does not install Crepe's CodeMirror
feature. Shiki's TextMate language loader and alternate highlighter were unreachable
through these App paths. The dependency patch removes those two dynamic imports,
keeping Highlights, custom registrations and error propagation. All eight targeted
Diff tests passed, including lazy loading, navigation and failed reads. No existing
test was edited or removed. Production metadata reports zero `@shikijs/langs` modules
and zero Shiki backend modules after the cut, including shared chunks. This is not
yet the complete C9d registration inventory or checker.

Vite's installed bundler supplies module identities; `rollup-plugin-visualizer` 7.1.1
writes its raw module-to-chunk graph to `target/release-modules.json`, outside dist.
The reference diagnostic graph attributes 8,598,779 rendered source bytes to
`@shikijs/langs`, 5,384,739 to Mermaid, 4,304,013 to Excalidraw and 2,546,895 to elkjs.
These are attribution lengths before final output minification, not artifact sizes.
A Mermaid deduplication trial reached 16,808,415 dist bytes but was discarded:
it substitutes Mermaid 12 for the converter's declared Mermaid 11 dependency.
Both installed versions and all diagram registrations remain in this implementation.

Reference release settings were thin LTO, one codegen unit and default unwind. The
implementation adds Cargo symbol stripping, retaining unwind. A separately stripped
reference copy measured 22,463,888 bytes: diagnostic only, never the gated artifact.
`size` attributed 21,904,586 bytes to text and 555,616 to data. `cargo tree -p rupd
-e features -i aws-lc-rs` traced AWS-LC to reqwest's rustls feature; native symbol
attribution included two AES-GCM functions of 339,921 and 339,925 bytes. This
establishes that stripping alone misses the cap; no TLS feature cut is claimed.

The unwind audit searched `catch_unwind`, `should_panic`, panic-inspecting joins and
helper/caller bodies. Production `runtime::guarded` protects Messages dispatch and
delivery, and `Store::atomically` rolls back and resumes unwinding. These four
panic-dependent tests passed in the five-test B28 run:
`b28_a_panic_in_a_locked_operation_leaves_the_next_calls_working`,
`b28_a_failed_operation_changes_nothing_listed`,
`b28_a_transaction_open_at_a_panic_rolls_back`, and
`b28_a_failure_in_on_status_does_not_stop_delivery`.
Terminal `pty::pump` retains its parser catch; no injected parser-panic test was found.
Agent owner-read thread shutdown and PR-reader joins retain their panic handling;
no injected thread-panic test was found. No `should_panic` annotation was found.

Harness unwind cases remain unmodified and need their results collected before full
acceptance: rupd's `n7_launch_sites_clean_on_success_and_failure` and
`n7_caller_owned_data_survives_restart_and_failed_start`; rup's
`n7_launch_sites_clean_on_success_and_failure` and
`n7_refused_launch_cleans_on_write_and_timeout_panic`; desktop's
`n6_h18_cleans_data_after_stop_and_failure`. The s2297a main-thread harness catches
test failures, and `u3787f_panel_does_not_activate_main_window` catches worker failures
for native cleanup; their macOS results remain outstanding.

Neither byte cap is met. The qualified R13/R16 comparison, its cold-start and other
metric table, macOS cold-start comparison, full registration inventory and C9d
checker remain outstanding. `just perf --out /tmp/c9-reference-perf.json` built the
reference release and entered the same-job paired observer; no completed report or
performance pass is claimed here. Hosted calibration #3706 is not needed by this
new paired path. A manual check-workflow dispatch returned HTTP 403; draft PR jobs
skip the release lanes, so their skipped runs are not macOS evidence.

Raw build logs, module graphs, command results and unwind-test output are retained
in the producing [Builder run](https://github.com/roundup-app/roundup/actions/runs/40242009209),
artifact `answer-3807`, directory `release-3807`. Its `SHA256SUMS` identifies the
retained files; its reproduction table includes failed and discarded attempts.
The raw reports are not committed.
