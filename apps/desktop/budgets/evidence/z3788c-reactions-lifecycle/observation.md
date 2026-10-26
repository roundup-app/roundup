Z3788c Reactions focus row, Linux/Chromium, 2026-10-26.

| Observer | Result |
| --- | --- |
| Cleanup mutation | Removing the old cleanup makes `z3788c_only_the_current_reactions_owner_refreshes_on_focus` fail: the disposed App receives an extra reaction.list call. |
| Production entry closure | 408660 → 408663 gzip bytes; same host, gzip level 9, recursive static imports counted once. Both pass unchanged 437814 ceiling. |

Installed event-listener 2.4.6 replaces the native EventTarget add/remove pair directly under the existing Solid owner. The unchanged refresh callback still refuses refresh after Daemon exit. There is no new wrapper or dependency. The npm registry records event-listener 2.4.6 on 2026-07-04, with Solid ^1.6.12 covering installed 1.9.17; react-use 17.6.1 on 2026-06-10. Its useEvent requires React effects and cannot bind a Solid owner.

The existing Reactions suite retains draft, destination, revision, action, failure and focus proofs. No test was cut: none was superseded by this lifecycle observer. It catches leaked work after disposal, which the existing form/remount observers do not count.

P1/P9 require zero Terminal writes; P3 keeps native attention reachable; P11 keeps exact unsent Reactions drafts and their original identity. This slice changes no layout or motion. D2/D5/D6 remain required. Remaining addons, Bubble/cutTitle lifecycle, storage probes and virtualization measurements stay on #3853. No native timing or Terminal addon byte/memory pass is claimed; the measured byte change is reported. The user reports what they meet on the Mac.

The archived observer uses an isolated headless agent-browser session and a fresh temporary profile. Start base/head Vite on 5215/5216 and set Z3788_REPO before running capture.py.txt. Its paired dark 1512×950 screens cover tree-40, agents-10 and conflict, opening/editing/closing/reopening the form, focus refresh, retained list and list-read failure. Images stay uncommitted under artifacts/ux/Z3788c.

The initial baseline build overlapped the temporary cleanup mutation. It is retained as discarded evidence in paired.json; the accepted baseline was rebuilt from untouched main. Both accepted production builds exit 0.

All 50 Reactions behavior tests pass. `just capture Z3788c` exits 0 with twelve paired dark screens. Every emitted Check passes, including D2/D5/D6; list-read failure remains visible beside the populated list. The exact unsent instruction survives closing and reopening. Six call journals contain zero Terminal writes. The desktop test-script selection was temporary and restored.

The first full web lint passed assertion, cycle and type checks, but the boundary scan rejected one report spelling; it is corrected without an exemption. The first Rust-lint invocation ended with signal 143 after proof output; the fresh complete invocation exits 0, including all proofs and eight mutation refusals. The broad related run failed attention and permission observers during setup; fresh focused executions of A3564a and U166 pass with the built binaries. U177 restart and the real-Daemon Pad draft/reopen observers also pass in the broad run. No complete related-suite pass is claimed.

Final full web lint exits 0, including boundaries, zero dependency cycles and type checks. Merge-loss and whitespace checks pass; no merge was needed. The broad related run was stopped with SIGINT at the run limit after 19 passing files and two setup failures; both failures pass focused fresh executions. CI judges the complete pushed head. No timeout or test was weakened.
