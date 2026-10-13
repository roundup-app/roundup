# J13 journey audit

Main: `bca4a4695b9276b666b7b0be996dfd2d138a78c7` (the exact SHA is recorded in `main.txt`). #1067, #1077 and capture ownership #1427 are completed on this main. Product code stayed at this revision throughout the audit.

Observer: a temporary Vitest driver used main's `startRealDaemon(..., true)` (the same real-Daemon development transport as `just harness-real`), `rupd <fresh temporary Project> --attached`, an isolated `CLAUDE_CONFIG_DIR`, proof of 64 zeros and the fake `claude`. The driver served `harness.html?daemon=1` at `http://127.0.0.1:41893`. `agent-browser --session j13-builder-38371955388` launched headless Chromium in a fresh test profile. No user browser, native window, real `claude`, CDP attachment or OS input ran. Only this run's browser and servers were closed.

The real driver used:

```text
FAKE_CLAUDE_KINDS=["blocked","working","idle","working","idle","error","needs-you","blocked","error","needs-you"]
FAKE_CLAUDE_ON_PROMPT_ASK={"tool_name":"Bash","tool_input":{"command":"echo $prompt"}}
FAKE_CLAUDE_ON_PROMPT={"name":"todo_create","arguments":{"title":"$prompt"}}
```

For each named step, `agent-browser set viewport <1280 or 1440> 800`, `screenshot`, `eval window.__checks()` and a DOM text/row reading were taken; every PNG has its complete `.checks.json` and `.dom.json`. Temporary captures were exported by a throwaway test using `captureDir("J13")` only through `just capture J13`; the driver/export tests are not product changes or completion tests. This policy audit is established by the observations and work Issues below, not by a report-text test.

| Stage | Same-main observation | Result |
|---|---|---|
| Enter | From the real empty Project, focus `button.pane-action`, press Enter: Workstream `1`, Terminal `1` and its Thread appear (`enter-empty`, `enter-created`). Pointer Add Workstream creates `7`. Fake `first-run` offers the chooser and cancellation stays empty (`enter-first-run`, `enter-chooser-cancelled`). Real `daemon=1&seed=first-run` instead shows the existing Project immediately (`enter-real-first-run-ignored`, `real-open.json`). Fake stopped Door shows Start Door; rejection shows `J13 start refused` (`enter-stopped`, `enter-start-failed`). | Keyboard creation and pointer creation reach a real Thread. Full first-run choice to Thread unproved: #1444. Starting state is behavioral U143 coverage, not a timed capture. |
| Request | Fill the Thread with `create a Todo for the J13 audit outcome`, press Enter, approve its `echo …` Decision by pointer: Todos `3` and `4` carry that title and Home `1` (`request-decision`, `request-outcome`, `request-rpc.json`). Two user Messages were sent; both remain delivered, with one resulting Todo each, not a claim of duplicate delivery for one send. In the fake stopped-Door observer, reject a send with `J13 send refused`: exact draft `keep this request on failure` stays visible (`request-failed-input`). | Concrete action and resulting Todo proved on the real Daemon with the fake `claude`. Failed-call text and input retention proved on the fake seam. No settled-work summary or real `claude` behavior claimed. |
| Understand | Two Workstreams, five Agents in each, added by pointer. Stop idle Agent `4`: the ten now include blocked `2,10`, working `3,5`, done `4`, idle `6`, error `8,11`, needs-you `9,12` simultaneously (`understand-six-kinds`, `six-kinds-rpc.json`). Each has a distinct accessible Glyph and visible shape. Collapsed rows show their Agent Glyphs, with no elapsed-time/Agent-count Live line (`understand-collapsed`); blocker Todos are distinct. Select working `3` (`understand-working`). Five attention jumps visit `8,11,1,7,9`: errors first, then the Doors and Agent needing attention (`jump.json`, `understand-jump`), skipping blocked, working, idle and done. | All six Kinds together, two blocked Agents and collapsed groups proved. The five observed jumps do not claim a complete wrap; main's `u356_` behavioral observer covers wrap and routine-progress silence. The selected row and parent Workstream remain identifiable. |
| Intervene | Pointer Allow clears the request's Decision and creates its Todo. Pointer Allow also answers the long Door setup command (`intervene-long-command`); selecting error `8` exposes its Stop action and watched Terminal (`intervene-error`), with no unrelated Decision. Stop on `4` produces done without removing its Workstream. | Real Decision answer/action continuation and stopping an Agent proved. The fake asks for Door setup, clarification and Digest prompts too: those extra permissions are fixture behavior, not product requirements. Native direct typing and real `claude` are unclaimed. |
| Review | Select Workstream `1`, choose This one, open Todo `3`: Drawer shows its title, Home move control and No body (`review-workstream`, `review-drawer`). Restart the real Daemon on the same temporary Project; the exit screen is visible, reload restores both Workstreams, all ten Agent identities and Todos (`daemon-exited`, `review-reopened`). | Inspection and reopen proved. The Todos are byte-for-byte equal before/after. Both user Messages stay delivered; queued Digest/Decision Messages become dropped with receiver gone as the Daemon stops, so the full Message arrays are not asserted identical. |

## Checks and gaps

All measured Checks (D1–D14 and D16; D15 is absent from main's observer) pass on 40 of the 44 captures. The two failed-call steps fail D3 and D10 at both widths: `p.ink`, `calm: true`, red `rgb(196, 38, 46)`. Every other Check on those four captures passes. These are pre-existing main failures, not introduced or waived by this audit. D3 is `docs/design-system.md:127`; D10 is line 134. The actual red alert remains readable and the rejected-send draft survives.

| Gap | Scenario and owner | Native blocked-by |
|---|---|---|
| Real first-run observer always starts with an open Project and cannot return a chooser result | U463, #1444 | #1083, because its specification is in this audit PR |
| Failed-call alert is red while D3 reports calm | U464, #1445 | #1083, because its specification is in this audit PR |
| Repeat all five stages after those repairs | J14, #1446 | #1083, #1444, #1445 |

Duplicate searches included open Issues/PRs, `first-run real Daemon`, `Enter Project chooser`, `D3 error` and `failure colour`. U144/#408 intentionally leaves its served chooser null and owns no first-run mode; no open Issue owns the observed failed-call/D3 conflict. The two implementation Issues are independent after this specification merges. The derived queue in `queue.json` reports both waiting on #1083 and J14 waiting on all three prerequisites. No immediately-ready audit successor is left. Existing product UI work keeps its owners; no implementation is included here.

Enter is the first unproved stage. J13's audit acceptance is delivered by this evidence and its scoped, natively ordered gap Issues; the full journey is not declared complete. The native folder chooser and macOS rendering remain outside the browser proof, and the user reports what they meet on the Mac. The obsolete earlier report claim that a Door summary has no method is not repeated: `checkpoint.write` exists on this main, while U422 removes Checkpoints from the view; this audit did not drive a settled-work summary.

Validation results are recorded in `validation.txt` after commands exit.
