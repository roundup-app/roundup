# J1 journey audit

Main: `84599c3`. Open PRs: #354 (H18), #352 (B1–B18), #349 (U134, U135), #330 (F7 re-run). Chromium on the same Mac, light theme, `just harness <seed> 5199` (Vite on the fake Daemon), agent-browser, 1280×800 and 700×800. `<stage>-<width>.png` and `.checks.json` (the complete `window.__checks()`) are in this directory. Seeds: `first-run`, `empty-project`, `door-stopped`, `conflict` (Enter), `agents-10` (Understand). Nothing here ran a real Daemon, a real `claude` or the native App.

D3, D4, D5, D8 and D9 pass on every capture. D1 and D10 fail on all ten, D2 on eight (all but `first-run`), D6 and D7 fail only on `door-stopped`. These failures predate this audit; none is introduced or excused here.

| Stage | Observed | Verdict |
|---|---|---|
| Enter | `first-run` offers `choose folder…`; `empty-project` and `door-stopped` carry U143's first action and Door state (its `u143_` tests are on main). Stopped Door fails D6 and D7 at both widths. The native folder chooser and a real Door launch are unobserved. | Unproved: no Daemon-backed run from `first-run` to a Thread. |
| Request | No rendered or Daemon observer asks a Door for one action and reads the resulting Todo and outcome. The only way in is the fake App; real `claude` interaction is F7's open re-run (#330). | Unproved. |
| Understand | `agents-10`: error, needs-you, blocked and working rows differ by glyph and word, the header says `4 need you`, and the centre says `select an agent or a terminal`. The ten-Agent screen fails D1 and D2; no Room is selected in this seed, so selected-Room identification is unobserved. | Unproved: selected Room and routine-progress silence are not observed. |
| Intervene | The seeds show needs-you rows but no Decision Card: U113 is waiting on H18 (#354, in flight), so the user cannot answer anything in the App. | Unproved; owned by H18 then U113. |
| Review | No Room-scoped result view; reopen is covered by the Daemon's A8 and S5 tests, not by a rendered observer. | Unproved. |

## First unproved behavior

Earlier-run Agent or Terminal with no saved output: selecting one leaves a blank pane with no explanation (a Review/Intervene dead end), already specified as **U83** (`scenarios/ui-surfaces.md`, ready, no PR, no Claim). It is the only independent gap with an owner-less ready row; H18/U113 (Intervene) and B1–B18 are owned by open PRs, and F7 by #330. No new implementation row is added. J2 waits on U83.

# J2 journey audit

Main: `4649c5f` (holds U83, H18, U143; open PRs #393 U113, #396 B1–B18, #349 U134/U135, #330 F7 re-run). Same method as J1: `just harness <seed> 5199`, agent-browser, Chromium, light, 1280×800 and 700×800, all twelve seeds-by-width read with `window.__checks()`. New captures: `j2-earlier-run-*` and `j2-agents-10-*` (`.png` and `.checks.json`). The J1 captures of `first-run`, `empty-project`, `door-stopped` and `conflict` were repeated and read the same: `first-run` fails D1, D10; `empty-project` and `conflict` fail D1, D2, D10; `door-stopped` additionally fails D6 and D7 (`textarea.xterm-helper-textarea`: no hover state, no pressed state) at both widths. Nothing here ran a real Daemon, a real `claude` or the native App.

| Stage | Observed | Verdict |
|---|---|---|
| Enter | Unchanged since J1. The webview reaches a Daemon only through Tauri commands, so no browser run can go from `first-run` to a Thread on a real Daemon. | Unproved: needs U144. |
| Request | Daemon half: `b24_` and `d3_` in `crates/rup/tests/e2e.rs` drive a Door over MCP against the fake `claude`; no rendered run reads the Todo in the Shelf. Real `claude` is F7's re-run (#330). | Unproved: needs U144 for the rendered half. |
| Understand | `agents-10` unchanged: glyph and word separate error, needs-you, blocked, working; header `4 need you`; no Room selected, so selected-Room identification stays unobserved. | Unproved. |
| Intervene | No Decision Card renders on main; U113 (#393) is in flight. | Unproved; owned by U113. |
| Review | U83 now renders: `earlier-run` selected shows `no output kept from an earlier run` at both widths, so that dead end is closed. No result view of a Room and no rendered reopen. | Unproved: needs U144 for reopen; Room-scoped results have no contract. |

## Gap selected

Enter, Request and Review share one missing observer: the App cannot be rendered on a real Daemon outside the native App. Specified as **U144** (`scenarios/ui-first-journey.md`), After U143 (done), so ready. Intervene stays with U113 and the Meta-agent spike with #330; neither is duplicated. **J3** waits on U144 and repeats this audit through `just harness-real`.

Loop note, not changed here: `loop/rules.sh ready` marks a policy row done only by a `j<n>_` test, so J1 and J2 print `ready` after merging.

# J3 journey audit

Main: `caf5589` (holds U144; open PRs #461 and #468 are loop machinery only). Method: `rupd <tmp project> --attached` with the fake `claude` and `RUPD_SOCKET`, then `just harness-real <project> 5199`, agent-browser (Chromium, light) at 1280×800 and 700×800, `window.__checks()` read after each step. Captures: `j3-enter-room-1280`, `j3-request-1280.png`, `j3-daemon-gone-1280.png`, `j3-review-reopen-*` (`.png`, with `.checks.json` where a Check ran). Nothing here ran a real `claude` or the native App.

| Stage | Observed | Verdict |
|---|---|---|
| Enter | From the empty Project, `start a Room` created a Room and started its Door on the real Daemon; the Rail row and a Terminal came from it. D1 and D10 fail on the empty screen; with the Room, D5 (`span.live-label`, 4.18:1), D6 and D7 (`textarea.xterm-helper-textarea`) fail too at 1280. The Thread input sits flush with the window's bottom edge (y 776 to 800), also with no Room (U145, #440). The native chooser, the keyboard path and failure states were not re-run. | Unproved as a stage; the pointer path reaches a Thread on a real Daemon. |
| Request | `ship j3` typed in the Thread reached the Daemon and showed as `you → room note …`. After 15 s the Room still read `starting`, the Thread showed no delivery state, and `todos` read `no todos yet`: the fake `claude` is scripted only by its start-up environment and never reads typed text. | Unproved: no Door action, Todo or outcome is observable. |
| Understand | Not driven: the real Daemon holds one Room. `agents-10` is unchanged from J2. | Unproved. |
| Intervene | Not driven; U113 owns the Decision Card. | Unproved. |
| Review | Killing `rupd` showed `daemon exited by signal` with `reopen`. After a restart and reload the Room and the Thread's Message were found again; the Room read `Door stopped` with `start Door`. D6 and D7 pass at both widths (D1, D5, D10 fail). No Todo or result existed to find. | Reopen of a Room and its Thread proved on the real Daemon; result inspection unproved for want of a Request outcome. |

## Gap selected

The first unproved behavior is Request: nothing makes a Door act on a Thread message. Specified as **U146** (`scenarios/ui-first-journey.md`): `FAKE_CLAUDE_ON_PROMPT` in the fake `claude`, the Message's `delivered` status in the Thread, and the Todo in the Shelf, observed by `u146_` tests on the real Daemon. U145 (#440) and U113 keep their owners. **J4** repeats this audit once U146 is on main.

# J4 journey audit

Main: `b2a75608` (holds U146; open PR #515 is U150 only). Method: `rupd <tmp project>` (not attached) with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude` and `FAKE_CLAUDE_ON_PROMPT='{"name":"todo_create","arguments":{"title":"$prompt"}}'`, then `just harness-real`'s Vite on port 5199, agent-browser (Chromium, light), `window.__checks()` read after each step. `u146_a_message_to_a_started_door_is_delivered_and_its_todo_shows` passes on this main (`pnpm exec vitest run src/testing/u146_door_answers.test.tsx`). Captures: `j4-request-1280.png` and `.checks.json`, `j4-review-todo-1280.png`, `j4-review-reopen-1280` and `j4-review-reopen-700` (`.png` and `.checks.json`). The Request step was captured at 1280 only. Nothing here ran a real `claude` or the native App.

| Stage | Observed | Verdict |
|---|---|---|
| Enter | `start a Room` created the Room and started its Door; the Rail row read `idle`. Not re-run by keyboard or on the failure states. | Unproved as a stage; the pointer path holds as in J3. |
| Request | `ship j4` typed in the Thread and sent: the Thread read `you → room note ship j4 delivered`, the Shelf listed `#1 ship j4`, the Room read `idle`, with no reload. The Terminal shows the fake's raw `^[[200~[from you, note] ship j4^[[201~` (the fake's tty echo, not a product claim). D3, D4, D8, D9 pass; D1, D2, D5, D6, D7, D10 fail. | Proved on the real Daemon with the fake `claude`; a real `claude` is F7's. The result is a Todo only: no Door summary exists (no method, `ui-first-journey.md` Capability paragraph). |
| Understand | Not driven: the real Daemon holds one Room. | Unproved. |
| Intervene | Not driven; U113 (#380) owns the Decision Card. | Unproved. |
| Review | The Todo opens in its Drawer (`ship j4`, `no body`). After `rupd` was killed and restarted and the page reloaded, the Rail read `done`, `terminal gone` with `start Door`, the centre `Door stopped`, the Thread still showed the Message `delivered` and the Shelf the Todo. D6, D7 pass; D1, D2, D5, D10 fail, at 1280 and 700. Nothing ties the Todo to the Room: `todo.create` has no Home (`Todo` has no Room field, T12 is specified but unbuilt), and the Shelf lists the whole Project. | Reopen proved. Finding the Door's work from its Room is unproved: no Home, no Room view. |

## Gap selected

The first unproved behavior is Review: the Door's work cannot be found from its Room. T12 and T13 (Home, `todo.move`) and U151, U157 and U158 (Home line, move, follow the Room) are specified with no implementation Issue; this audit files those two (#516, #517). T14 (#518: an Agent's Todo takes its Room as Home) and U159 (#519: the Shelf's `this room`) are new. Each Issue is blocked by the one before it. **J5** (#520) repeats this audit once they are on main. The D1, D2, D5, D10 failures predate this audit and keep their owners (#382, #385, #386).

# J5 journey audit

Main: `0a507eea` (holds T12, T13, T14, U157, U158, U159; open PRs are loop machinery only). Method: `rupd <tmp project>` (not attached) with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude` and `FAKE_CLAUDE_ON_PROMPT='{"name":"todo_create","arguments":{"title":"$prompt"}}'`, then `just harness-real`'s Vite on port 5199, agent-browser (headless Chromium, light), `window.__checks()` read after each step. Captures: `j5-request-1280.png`; `j5-review-this-room-1280`, `j5-review-todo-1280`, `j5-review-reopen-1280`, `j5-review-reopen-700`, `j5-two-rooms-1280` (`.png` and `.checks.json`); `j5-door-reply-1280` and `-700` (a second `rupd` whose fake answers with `message_send {to: "you"}`). Nothing here ran a real `claude` or the native App.

| Stage | Observed | Verdict |
|---|---|---|
| Enter | `start a Room` created a Room and started its Door; a second and third Room came from `+ room`. A stopped Room's `start Door` ended as `retry Door` after a Daemon restart (#351 owns the stopped-Room start). Keyboard and failure states not re-run. | Unproved as a stage; the pointer path holds. |
| Request | `ship j5` typed in the Thread: the Thread read `you → room note ship j5 delivered`, the Shelf listed `#1 ship j5`, the Room read `idle`. With the fake calling `message_send {to: "you"}`, `room → you note done j5` reached the Thread. A fake Door's reply and Todo are proved; a real `claude` stays F7's. | Proved on the real Daemon with the fake `claude`. |
| Understand | Three Rooms exist on the real Daemon. All three read `room` on the Rail, and the Thread of the newest Room listed Messages sent to the other two (`j5-door-reply-1280.png`). Ten Agents and routine-progress silence were not driven. | Unproved: the Thread is not Room-scoped (U160). |
| Intervene | Not driven; U113 (#380) owns the Decision Card. | Unproved; owned by U113. |
| Review | The Todo the Door made showed under `this room` and its Drawer read `in room` (T14, U158); moving it to `project root` emptied `this room` (`no todos in this room`) and moving it back restored it; a second Room's `this room` read `no todos in this room`. After `rupd` was restarted and the page reloaded the Rail read `done`, `terminal gone`, `start Door`, the Thread kept the Message and the Todo was found again (the choice is back to `all`, as U159 says). D3, D4, D8, D9 pass; D1, D2, D5, D6, D7, D10 fail at 1280 and 700, in every capture. With the Drawer open the row title is missing and the move control overlaps the `pads` header at 1280 (`j5-review-todo-1280.png`); the Todos panel is #398's. | Proved: the Door's work is found from its Room and again after reopen. The Door's summary when work settles (P1) has no method and is not claimed. |

## Gap selected

The first unproved behavior is Understand: with more than one Room the Thread mixes every Room's Messages, so the Door's outcome is not read from its Room. Specified as **U160** (`scenarios/ui-first-journey.md`) with one implementation Issue; no prerequisite is missing. Intervene stays with U113 (#380) and the stopped-Room start with #351. **J6** repeats the audit once U160 and U113 are on main. The D1, D2, D5, D6, D7, D10 failures predate this audit and keep their owners (#382, #385, #386).

# J6 journey audit

Main: `b3a16d4a` (holds U160 and U113; open PRs #548 and #550 are other work). Method: `rupd <tmp project> --attached` with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude`, `FAKE_CLAUDE_PAYLOADS=spikes/hooks-state/log.run1.jsonl`, `FAKE_CLAUDE_EVENTS=SessionStart,PermissionRequest` and `FAKE_CLAUDE_ON_PROMPT='{"name":"message_send","arguments":{"to":"you","kind":"note","body":"done $prompt"}}'`, then `just harness-real`'s Vite on port 5199, agent-browser (headless Chromium, light, isolated session), `window.__checks()` read after each step. Captures: `j6-decision-1280`, `j6-room2-decision-1280` and `-700`, `j6-room1-decision-1280`, `j6-both-answered-1280`, `j6-room1-thread-1280` and `-700`, `j6-room2-thread-1280` and `-700` (`.png` and `.checks.json`), `j6-room1-thread.txt`, `j6-room2-thread.txt`. Nothing here ran a real `claude` or the native App. Not driven: ten Agents (J2's `agents-10` stands) and routine-progress silence.

| Stage | Observed | Verdict |
|---|---|---|
| Understand | Two Rooms, each Door asked for a permission: the header read `1 need you` while `decision.list` held two Decisions; Room 1's Rail row read `needs-you` with `Bash: touch x.txt`, Room 2's read `idle` (from `rail.tree`: Room 2 `idle` with `d2` open). That mismatch follows the fake playing `SessionStart` again after the permission, which a real `claude` does not, so it is recorded, not claimed. Both Rooms are named `room`, so Rail rows, `Decision for room` and Thread lines are identical (`j6-room2-decision-1280.png`). Each Room's Thread listed only its own Message (`ship a`, `ship b`; U160 holds). | Unproved: selected-Room identification fails with two Rooms (U167). |
| Intervene | The selected Room showed its own Decision (U113): Card with `Bash`, `touch x.txt`, `allow` and `deny`. `allow` in Room 2 cleared the Card and the Rail read `working` (`rail.tree` `working`, `decision.list` held only `d1`); the same in Room 1. D2, D3, D4, D8, D9 pass; D1, D5, D6, D7, D10 fail, at 1280 and 700, in every capture. The Rooms stayed `working`: the fake plays no `PostToolUse` or `Stop`, so a Message typed to Room 1 stayed `pending` (`message.list`) and no reply, Todo or `idle` was observable. | Answer and `working` proved on the real Daemon; the Door finishing its action after an Intervene is unobservable (U166). |
| Review | Not driven past the Thread: no Door reached its prompt, so no Todo existed under `this room`. | Unchanged from J5. |

## Gap selected

The first unproved behavior is Understand: with two Rooms the user cannot tell which one the Decision or the Thread belongs to. Specified as **U167** (`scenarios/ui-first-journey.md`), blocked by the Workstream rename (#369) because it changes the default name. Intervene cannot be observed to its end for want of a fake that resumes: **U166**, no prerequisite. **J7** repeats this audit once both are on main. The D1, D5, D6, D7, D10 failures predate this audit and keep their owners (#382, #385, #386).

# J7 journey audit

Main: `83b5e7f3` (holds U166 and U167; open PRs #614, #627, #632, #636 and #637 are other work). Method: `rupd <tmp project> --attached` with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude`, `FAKE_CLAUDE_ON_PROMPT_ASK={"tool_name":"Bash","tool_input":{"command":"echo $prompt"}}` and `FAKE_CLAUDE_ON_PROMPT={"name":"todo_create","arguments":{"title":"$prompt"}}`, then `just harness-real`'s Vite on port 5199, agent-browser (headless Chromium, light, isolated session), `window.__checks()` read after each capture. Captures (`.png` and `.checks.json`): `j7-ws1-card-1280`, `j7-ws1-settled-1280`, `j7-ws1-this-workstream-1280`, `j7-ws2-card-1280`, `j7-ws2-settled-1280`, `j7-ws2-this-workstream-1280`, `j7-ws2-thread-700`, `j7-ws3-card-700`, `j7-ws3-settled-700`, `j7-ws1-thread-700`, `j7-reopen-1280`, `j7-retry-door-1280`, `j7-agent-direct-card-1280`, `j7-agent-direct-settled-1280`, `j7-agent-todos-on-rail-1280`, `j7-agents-10-1280` and `-700`; the Threads are `j7-ws1-thread.txt`, `j7-ws2-thread.txt`, `j7-ws3-thread.txt`, `j7-reopen-ws1-thread.txt` and `j7-reopen-ws2-thread.txt`. Nothing here ran a real `claude` or the native App.

D4, D5, D8 and D9 pass on every real-Daemon capture and D3 on all but `j7-retry-door-1280`; D1, D2, D6, D7 and D10 fail on all of them. `agents-10` fails D1 and D10 only. These failures predate this audit and keep their owners (#382, #385, #386).

| Stage | Observed | Verdict |
|---|---|---|
| Understand | Three Workstreams were named `workstream`, `workstream 2` and `workstream 3` on the Rail, in the Card (`Decision for workstream 2`) and in the Thread (`you → workstream 2 note ship b`): U167 holds. With one Decision pending the header read `1 need you`, that Workstream's row read `needs-you` with `Bash: echo ship a`, the others `idle` (J6's mismatch is gone). A Message to the first Workstream was `delivered` while it asked; each Thread listed only its own Message (U160 holds). Two Agents added with `+ agent` to one Workstream are both named `what-should-this` (`j7-agent-direct-card-1280.png`), so their rows and Cards are identical. The ten-Agent `agents-10` seed has no Workstream and no selection, so a selected Workstream among ten Agents stays unobserved. | Proved for Workstreams on the real Daemon; unproved for Agents (U176) and for ten Agents. |
| Intervene | `allow` cleared the Card, the Workstream went `needs-you` to `idle` with no reload, the Message stayed `delivered` and the Todo `#7 ship a` appeared, listed under `this one` of that Workstream (U166 holds). `deny` on `ship b` left the Workstream `idle`, the Message `delivered` and no Todo; the other Workstreams did not change. An Agent entered directly in its Terminal (`ship d`) asked, `allow` resumed it to `idle`, and its Todo exists (`todo.list`: `#11 ship d`, home the Workstream). After the Daemon was restarted every Workstream read `done`, `terminal gone`; the Threads and Todos were found again, but `start Door` ended as `Door did not start`, `3: no acknowledgement within 8s`, `retry Door`, because the fake plays only `"source": "startup"` while a reopened Door waits for `resume` (`fake_claude.py:175`, `is_resume_ack`). | Answer, resume and deny proved; starting a stopped Door again is unobservable (U177). |
| Review | The Todos a Door made show under `this one` of its Workstream; a second Workstream's list held only its own. The four Todos of the entered Agent (home the Workstream) show in neither `all` nor `this one`: U60 puts them under the Agent's row behind a control named `4 pads`, and `this one` is not rendered with an Agent selected (`j7-agent-todos-on-rail-1280.png`). The Door's summary of settled work (P1) still has no method and is not claimed. | Proved for a Door's Todos; unproved for an Agent's (U178). |

## Gap selected

The first unproved behavior is Understand with Agents: two Agents of one Workstream cannot be told apart. Specified as **U176** (`scenarios/ui-first-journey.md`). Intervene cannot be observed through a Door restart for want of a fake that resumes: **U177**. The Workstream's work under an Agent is not readable from the Workstream: **U178**, after U176. **J8** repeats this audit once all three are on main. Ten Agents in Workstreams are not driven here; the J2 `agents-10` capture stands.

# J8 journey audit

Main: `0d8310b3` (holds U176, U177 and U178). Method: `rupd <tmp project> --attached` with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude`, `FAKE_CLAUDE_ON_PROMPT_ASK={"tool_name":"Bash","tool_input":{"command":"echo $prompt"}}` and `FAKE_CLAUDE_ON_PROMPT={"name":"todo_create","arguments":{"title":"$prompt"}}`, then `just harness-real`'s Vite on port 5199 (with `RUPD_SOCKET` set), agent-browser (headless Chromium, light, isolated session `j8`), `window.__checks()` read after each capture. Captures (`.png` and `.checks.json`): `j8-ws2-card-1280`, `j8-long-decision-covered-1280` and `-700`, `j8-two-agents-1280` and `-700`, `j8-agent-selected-1280`, `j8-ws2-this-one-1280`, `j8-ws2-thread-1280` and `-700`, `j8-restarted-1280`, `j8-restarted-card-1280`, `j8-restarted-agent-1280`, `j8-agent-menu-1280`, `j8-ws1-card-1280`, `j8-ws1-settled-1280` and `-700`; the Threads are `j8-ws1-thread.txt` and `j8-ws2-thread.txt`. Nothing here ran a real `claude` or the native App. Not driven: ten Agents (J2's `agents-10` stands).

D3, D4, D5, D8 and D9 pass on every capture and D2 on all; D6, D7 and D10 fail on all but `j8-restarted-agent-1280` and `j8-agent-menu-1280` (their Check ran with the menu or an Agent's empty pane up). D1 passes except on `j8-two-agents` and `j8-agent-selected`. The D6, D7 and D10 failures predate this audit and keep their owners (#385, #386).

| Stage | Observed | Verdict |
|---|---|---|
| Understand | Two Workstreams (`workstream`, `workstream 2`) and two Agents added by `+ agent` to the second: `what-should-this` and `what-should-this-2` on the Rail and in `Decision for what-should-this-2` (U176 holds). Each Agent's Rail row read `needs-you` with its tool while its Decision was pending, and `idle` once answered; the first Workstream did not change. The fake plays every prompt, so each Agent status digest the Door receives asks again and Workstream 2 stays `needs-you`: recorded, not claimed. | Proved for Workstreams and two Agents on the real Daemon; ten Agents unproved. |
| Intervene | Pressing `allow` by pointer on the Door's clarification-order Decision did nothing: the Card is 57 px tall with 70 px of content, `allow` and `deny` sit at y 83 to 107 and the order line starts at y 101, so `elementFromPoint` at the centre of `allow` is the order line, whose click opens its Drawer (`j8-long-decision-covered-1280.png`, `-700.png`). Focusing `allow` and pressing Enter answered (`decision.list` emptied, Todo `#5` appeared). A short command's Card (`echo ship e`) answered by pointer and the Workstream read `idle`. After the Daemon was restarted every Workstream and Agent read `done`, `terminal gone`; `start Door` on each Workstream made it `idle` with no `retry Door` (U177 holds), a Message `ship e` was `delivered` and its Todo `#15 ship e` appeared; the Agent's menu offered `resume` and `resume` made it `idle` (U68). | Answer by keyboard, restart and resume proved; answering a long command by pointer fails (U194). |
| Review | `this one` of Workstream 2 listed `#5`, `#7`, `#8`, `#10`, the Todos of its Agents, in the Todo order, and the Agent rows' control read `2 todos` (U178 holds). After the restart the Todos and Threads (`you ship e`, `you ship f`) were found again. With an Agent selected the Shelf shows no `all`/`this one` pair (U178 states Workstream selection only) and its Todo cards are cut at the Shelf's right edge with a horizontal scrollbar (`j8-restarted-agent-1280.png`; the Todos panel is #398's). The Door's summary of settled work (P1) still has no method and is not claimed. | Proved for Todos of Workstreams and Agents; the summary is unproved. |

## Gap selected

The first unproved behavior is Intervene by pointer: a long command's Decision cannot be answered with the pointer. Specified as **U194** (`scenarios/ui-decisions.md`), one implementation Issue, no prerequisite. **J9** repeats this audit once U194 is on main. Ten Agents in more than one Workstream stay unobserved and go to J9.

# J9 journey audit

Main: `6f317c9f` (holds U194). Method: as J8 (`rupd <tmp project> --attached`, `RUPD_SOCKET`, the fake `claude`, `FAKE_CLAUDE_ON_PROMPT_ASK={"tool_name":"Bash","tool_input":{"command":"echo $prompt"}}`, `FAKE_CLAUDE_ON_PROMPT={"name":"todo_create","arguments":{"title":"$prompt"}}`, `just harness-real`'s Vite on port 5199, agent-browser headless Chromium, light, isolated session `j9`, `window.__checks()` read after each capture). Two Workstreams, five Agents added by `+ agent` to each. Captures (`.png`, and `.checks.json` where a Check ran): `j9-ten-agents-1280` and `-700`, `j9-mixed-1280`, `j9-ws1-this-one-1280`, `j9-ws2-this-one-1280`, `j9-long-decision-700`, `j9-long-answered-1280`, `j9-restarted-1280` and `-700`. Nothing here ran a real `claude` or the native App.

D1, D6, D7 and D10 fail on both `j9-ten-agents` captures (the Terminal's `div.xterm-scrollable-element` background and `textarea.xterm-helper-textarea`; their earlier owners #385 and #386 are closed, so they are filed as #836). Every other capture passes D1 to D10, including both restarted ones.

| Stage | Observed | Verdict |
|---|---|---|
| Understand | Ten Agents (`what-should-this` to `-5` in each Workstream) read `needs-you` on the Rail with the same filled glyph in bold, the Workstream rows too; after one was answered its row read `idle` with a small dot and its `2 todos` control, and no other row moved. The word and the tool are clipped at the Rail's 252 px (`just n`, `B..`), so a row tells `needs-you` from `idle` by glyph and weight. The fake plays every Agent the same way, so `working`, `blocked` and `error` rows, the `⌘J` jump among several rows and the Rail's order with mixed Kinds were not rendered. The Shelf's Todo cards are cut at its right edge with a horizontal scrollbar at 1280 (the Shelf's rework, #687). | Ten Agents in two Workstreams on the real Daemon: `needs-you` and `idle` proved; the other Kinds unproved: needs **U351**. |
| Intervene | A Door's long command (`echo Find the intent and elicit what is missing, asking whom …`; 64 px Card, `allow` at y 80 to 104, `elementFromPoint` at its centre is the button) and a 12-argument command at 700 px (117 px Card, `allow` at y 133, the button again) were each answered by a pointer click on `allow`: the Card cleared, the Workstream read `idle` and the Todo `#7 ship a-very-long-command-argument-1 …` appeared. U194 holds at both widths. | Proved: Intervene by pointer on a long command. |
| Review | `this one` of Workstream 2 listed `#3` to `#7` and of Workstream 1 `#1`, `#2`, the Todos of each Workstream and its Agents; the choice reads `all` again after selecting another Workstream (U159). After the Daemon was killed and restarted and the page reloaded, all ten Agents read `done` and each Workstream `terminal gone` with `start Door`; `start Door` by pointer on each made it `idle` (U177), and the Todos and Threads were found again. Each Agent stays `done` until its own menu's `resume` (U68, proved in J8). The Door's summary of settled work (P1) still has no method and is not claimed. | Proved for the Todos of two Workstreams, their Agents and a restart. |

## Gap selected

The first unproved behavior is Understand's other Kinds: the fake `claude` cannot hold an Agent in `working` or `error`, so a mixed ten-Agent Rail and the `⌘J` jump cannot be observed on a real Daemon. Specified as **U351** (`scenarios/ui-first-journey.md`), one implementation Issue (#831), blocked by this audit (#764). The Rail's clipped word and the Shelf's cut cards keep their open owners (#781, #687). The Terminal's D-check failures go to #836. **J10** (`scenarios/journey.md`) is the next audit, blocked by #831 and #836.

# J10 journey audit

Main: `5490d16d` (holds U351 and #836). Method: as J9 (`rupd /tmp/j10/proj --attached` with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude`, `FAKE_CLAUDE_KINDS` of `working, idle, needs-you, working, idle` for the first Workstream and `error, needs-you, working, error, needs-you` for the second, `FAKE_CLAUDE_ON_PROMPT` a `todo_create`, `just harness-real`'s Vite on port 5199, agent-browser headless Chromium, light, isolated session `j10`, `window.__checks()` read after each capture). Two Workstreams, five Agents added by `+ agent` to each, then a Terminal by `+ terminal`. Captures: `j10-ten-1280`, `j10-ten-700`, `j10-jump-error-1280`, `j10-terminal-1280` and `-700`, `j10-restarted-1280` (`.png`, and `.checks.json` where a Check ran). Nothing here ran a real `claude` or the native App.

D1 to D11 pass on every capture, including both with the Terminal selected: #836 holds.

| Stage | Observed | Verdict |
|---|---|---|
| Understand | Ten Agents read `working` (ring), `idle` (dot), `needs-you` (filled, bold, with its tool), `error` (`✕`, bold, red) by glyph and weight; the tab shows `◉`. `⌘J` from a `needs-you` row visited, in order, `u351-3`, `u351-2`, `u351-5` (the three `needs-you`) then `u351` and `u351-4` (the two `error`) and wrapped to `u351-3`; a `needs-you` row opens its Decision Card, an `error` row opens none and the centre shows only the Terminal. A `working` row and an `idle` row carry no word at the Rail's 252 px, and the Workstream rows read `idle` while expanded over `error` and `needs-you` Agents (U351 holds that collapsed they read the worst). After the Daemon was killed and restarted, all ten Agents read `done`. `blocked` was never rendered: no code in `crates/rupd` or `crates/agents` sets it. | Ten Agents in every Kind but `blocked` in two Workstreams, the jump and `done` proved; `blocked` unproved: needs **A33**. |
| Intervene | Not re-driven: J9 proved the Decision answered by pointer on a long command and U194 is unchanged on main. An `error` row offers no action in the centre. | Proved in J9 on the earlier main; the `error` row's action is owned by the Intervene scenarios, not claimed here. |
| Review | `this one` of the first Workstream listed `#1` to `#10` and `#21` to `#25`, with the Daemon's `[digest]` Messages as Todos (the fake turns every prompt into a Todo); the second Workstream's Todos were its own. The Shelf's cards are cut at its right edge with a horizontal scrollbar at 1280 (#687). | Proved for the Todos of two Workstreams. |

## Gap selected

The first unproved behavior is Understand's `blocked` Kind: the Daemon never decides it. Specified as **A33** (`scenarios/agents.md`), one implementation Issue (#863), blocked by this audit (#837). The Rail's missing words and the Shelf's cut cards keep their open owners (#781, #687). **J11** (`scenarios/journey.md`) is the next audit, blocked by #863 (#864).

# J11 journey audit

Main: `83809015` (holds A33). Method: as J10 (`rupd /tmp/j11/proj --attached` with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude`, `FAKE_CLAUDE_KINDS` of `idle, working, needs-you, working, idle` for the first Workstream and `error, needs-you, working, error, needs-you` for the second, `FAKE_CLAUDE_AGENT_TOOLS` of `todo_create blocker` then `todo_create waiting` with blockers `[1]`, `FAKE_CLAUDE_ON_PROMPT` a `todo_create`, `just harness-real`'s Vite on port 5199 with the same `RUPD_SOCKET`, agent-browser headless Chromium, light, isolated session `j11`). The first Agent is `idle` in `FAKE_CLAUDE_KINDS` because `blocked` is only read from an `idle` Agent. Two Workstreams, five Agents added by `+ agent` to each. Captures: `j11-ten-1280`, `j11-ten-700`, `j11-jump-error-1280`, `j11-blocked-1280`, `j11-workstream-todos-1280`, `j11-collapsed-1280`, `j11-restarted-1280` and `j11-restarted-expanded-1280` (`.png`, and `.checks.json` where a Check ran). Nothing here ran a real `claude` or the native App.

D1 to D11 pass on `j11-ten-1280`, `j11-ten-700` and `j11-restarted-1280`.

| Stage | Observed | Verdict |
|---|---|---|
| Understand | Ten Agents read `blocked` (`⏸`, `blocked u351 waits on #1`, one Agent), `working` (ring), `idle` (dot), `needs-you` (filled, bold, with its tool) and `error` (`✕`, bold, red). At 1280 the row's `waits on #1` is cut to `w` beside its `2 todos` count (#881 closed that as not planned, #781 owns the row); its accessible name carries it. `⌘J` from a `needs-you` row visited `error` (`u351`, `u351-4`) then `needs-you` (`u351-3`, `u351-2`, `u351-5`) and wrapped, skipping the `blocked` and `working` rows. Completing the waiting Todo turned the row `idle` with no reload. Collapsed, the Workstream rows read `needs-you` and `error`; the `blocked` Agent was already `idle` then. After the Daemon was killed and restarted all ten Agents read `done`. The second Workstream held no `blocked` Agent: `FAKE_CLAUDE_AGENT_TOOLS` is made by one run alone and an Agent that plays `working`, `error` or `needs-you` outranks `blocked`. | Ten Agents in every Kind in two Workstreams, the jump and `done` proved; a second `blocked` Agent and a Workstream collapsed over `blocked` unproved: needs **U356**. |
| Intervene | Not re-driven: J9 proved the Decision answered by pointer on a long command and no scenario has changed it. | Proved in J9 on the earlier main. |
| Review | `this one` of the first Workstream listed the Door's `#1`, `#2`, the `blocked` Agent's `#4 blocker` and `#5 waiting` (`blocked`) and the digests; with that Agent selected they showed under its row and the second Workstream's Todos were its own. The Shelf's cards are cut at its right edge with a horizontal scrollbar at 1280 (#687). | Proved for the Todos of two Workstreams. |

## Gap selected

The first unproved behavior is Understand with `blocked` in more than one Workstream and collapsed: the fake `claude` makes only one Agent's Todos. Specified as **U356** (`scenarios/ui-first-journey.md`), one implementation Issue (#888), blocked by this audit (#864). The Rail's cut `waits on` line and the Shelf's cut cards keep their open owners (#781, #687); the Door's summary stays without a method. **J12** (`scenarios/journey.md`) is the next audit, blocked by #888 (#889).

# J12 journey audit

Main: `2b0cf1e1` (holds U356). Method: the real `rupd` with the fake `claude`, as `u356_` starts it (`FAKE_CLAUDE_KINDS` of `blocked, working, idle, working, idle` for the first Workstream and `error, needs-you, blocked, error, needs-you` for the second, `FAKE_CLAUDE_ON_PROMPT` a `todo_create`), `just harness-real`'s page at `harness.html?daemon=1`, headless Chromium on a fresh profile through `chromePage` (never the user's browser), light, 1280×800 and 700×800. Both Workstreams and all ten Agents were started by pointer; `window.__checks()` was read in each capture. Captures: `j12-ten-1280`, `j12-ten-700`, `j12-jump-1280`, `j12-collapsed-1280`, `j12-collapsed-700` and `j12-workstream-todos-1280` (`.png` and `.checks.json`). The driver was a throwaway test and is not kept. Nothing here ran a real `claude` or the native App.

D1 to D14 pass on all six captures.

| Stage | Observed | Verdict |
|---|---|---|
| Understand | Two Workstreams of five Agents. Each Agent read its entry: `blocked` (`⏸`, `waits on #4` in the first Workstream and `waits on #22` in the second, two different blockers), `working` (ring), `idle` (dot), `needs-you` (filled, bold, with its tool) and `error` (`✕`, bold, red). `⌘J` from the selected `needs-you` row visited `error` (`u351`, `u351-4` of the second Workstream), then `needs-you` (`u351-2`, `u351-5`) and wrapped to `error`; it visited no `blocked`, `working` or `idle` row. Collapsed, the first Workstream (`blocked`, `working`, `idle`) read `⏸` and the second (`error`, `needs-you`, `blocked`) read `✕` and was red; the Agent count shows twice (`5 5`) on each collapsed row (#1067 removes it). At 1280 the `blocked` row's `waits on` is cut to `w.` and `·` (U7; U364 settles the cut at 1280 and 700 as expected); at 700 the Shelf covers the centre. A Workstream collapsed over `needs-you` with no `error` is not rendered here; `u351_` asserts it. | Proved: ten Agents in the five Kinds `blocked`, `working`, `idle`, `needs-you` and `error` (no `done` row was rendered), two `blocked`, in two Workstreams, the Workstreams collapsed and the jump. |
| Intervene | Not re-driven: J9 proved the Decision answered by pointer and no scenario has changed it. | Proved in J9 on the earlier main. |
| Review | The Shelf lists the Todos of both Workstreams, each tagged `in workstream` or `in workstream 2`, among them the blocker `u356 blocker` and `u356 waiting` (`⏸`, `waits on #4`). | Proved for the Todos of two Workstreams. |

## Gap selected

Gaps remain, each with an owner: the Agent count shown twice (#1067) and the Live line (#1077). Not observed on `2b0cf1e1`: Enter and Request were not re-driven, Intervene is proved in J9 on the earlier main, `done` was not rendered (J11 saw it only after a Daemon restart, on `83809015`), and the Door's summary has no method. U364 settles the cut `waits on` line. **J13** waits on #1067 and #1077, then re-drives every stage on one main.
