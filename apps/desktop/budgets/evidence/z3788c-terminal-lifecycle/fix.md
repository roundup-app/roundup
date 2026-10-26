# PR 4223 gate repair

The failing head was `f3b87356477e4178f924afa44e8050160d38b3d5`. Main `5f706c3a3` merged cleanly; merge-loss passes.

| Gate | Cause and repair |
| --- | --- |
| U1 | Native material imported Tauri outside the adapter. Move the existing subscription unchanged into `app/tauri.ts`; its three native preference tests and the unchanged U1 boundary observer pass. |
| M5 | The native material command had no MCP exclusion. Add the existing native command to the seam inventory and its App-only preference reason to `NO_TOOL`; no Agent authority is added. |
| Startup | After the main merge, the static closure measured 437859 gzip bytes, above 437814. Solid's installed `lazy` defers the optional measurement dashboard and timeline until opened: 436131 gzip bytes, 1683 bytes below the unchanged ceiling. No checker, budget or build configuration changes. |
| FUSE | The startup failure skipped dependency installation, then the always-running fault test could not find fuse3. Both fuse3 and its development headers are already installed by check.yml before the fault observers; no workflow repair is needed. |
| Rust 4 | All 28 selected tests and the test step passed. GitHub cancelled the job at its 35-minute limit after a 27-minute setup. No product failure or timeout change is inferred. |

The headless observer uses a dedicated session and fresh temporary profile. After the advertised localhost harness completed its dependency warmup, all six head captures passed every emitted Check at 1512×950 in dark mode: tree-40, agents-10 and conflict, before and after refit/Daemon exit. Terminal output and the exit feedback remain visible; all three call records contain zero terminal.write calls. Screenshots and detailed readings remain under `artifacts/ux/Z3788c/`, uncommitted. `just capture Z3788c` was invoked, then stopped because it duplicates the entire web suite; the focused rendered observer completed separately.

P3's requesting Terminal and P11's unfinished Terminal input are the affected gates: no Message input writes or native request handling changes. D2, D5 and D6 remain passing in the refreshed captures. The observer script is the existing `capture.py.txt`, using only the head port 5216; its cold navigation was preceded by the harness's `/__roundup_ready` signal.

The 100-test focused run (native material, U1, U13, U103 snapshot/recovery, dashboard navigation, and timeline including its rendered return/stop observer) passes. The additional seven WebGL reflow and scale cases pass. The broad related run encountered the pre-existing cold real-Daemon attention setup timeout while Cargo was compiling; it was stopped, and no broad-suite pass is claimed.

The M5 authority observer and all 40 MCP tests pass. Rust lint exits 0, including ALL PROOFS CHECK.

A fresh `a3564a_attention_opens_the_requesting_terminal` run passes after completing the native binary build and releasing the interrupted run's empty build lock. The final production build repeats exactly: 436131 gzip bytes, checker exit 0.

The final complete `just lint-web` run exits 0 after correcting declaration spacing and the evidence-note spelling match. Its cycle scanner also passes after the duplicate fixture-producing run ended. `pnpm install` completed before the push.


## R19 and U3791c gate repair

Source: `aa36ff3ea`, after a clean merge of main `ebbae60d3`.

| Observer | Result |
| --- | --- |
| R19 lazy-view lifecycle | Before: hidden case sends Escape to a missing element. After: each view mounts before interval assertions and Escape. All nine activity tests pass; focused R19 cases take 194–214 ms each. No test removed. |
| U3791c recovery | Before: the lazy dashboard owns Pane flex styles, leaving Retry beneath Ask. After: Pane owns those unchanged rules in its eager stylesheet. The unchanged rendered journey passes with real pointer actions and exact draft retention. |
| Production startup | Build and checker exit 0: 403337 gzip bytes below unchanged 437814 ceiling. |
| Required lints | Both complete lints pass, including ALL PROOFS CHECK; final Stylelint also passes after moving CSS. |
| Dark 1512×950 tree-40 | Recorded U3791c journey passes. Enter and all four failure screens pass every emitted Check; error and Retry are visible. Recovered Pad editor has D1/D2/D10 failures identical, including values, to main ebbae60d3. D5/D6 pass throughout. |

`just capture U3791c` was bounded at 60 seconds because it starts the entire web suite; no full-suite pass is claimed. The focused capture completed after installing the environment's missing ffmpeg. PNGs, Check readings and video remain uncommitted under `artifacts/ux/U3791c/`; U3791a failure images are also retained. A broad related run was stopped during cold Daemon compilation; the scenario-filtered related run passes all 10 selected tests in five files (190 files skipped). CI judges the complete pushed head.

The failed Rust lane had passed all 494 selected tests before cancellation during contract regeneration. No assertion, contract generator or timeout was weakened.
