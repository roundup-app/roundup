# Historical journey results

Result summaries retained under L112. Each audit describes its recorded revision, not current acceptance. Payload paths are artifact-relative under `artifacts/ux/journey/`; no expired download is claimed. Regenerate in a disposable checkout of the named revision with the recorded harness command and conditions, following the stages in [the journey scenarios](../scenarios/ui-first-journey.md), using an isolated headless browser.

## J1

Main: `84599c39a7cf08114c22859d0a53f1d3a1a4ea0b`. Open PRs: #354 (H18), #352 (B1–B18), #349 (U134, U135), #330 (F7 re-run). Chromium on the same Mac, light theme, `just harness <seed> 5199` (Vite on the fake Daemon), agent-browser, 1280×800 and 700×800. `<stage>-<width>.png` and `.checks.json` (the complete `window.__checks()`) are in this directory. Seeds: `first-run`, `empty-project`, `door-stopped`, `conflict` (Enter), `agents-10` (Understand). Nothing here ran a real Daemon, a real `claude` or the native App.

| Stage | Recorded result |
| --- | --- |
| Enter | Unproved: no Daemon-backed run from `first-run` to a Thread. |
| Request | Unproved. |
| Understand | Unproved: selected Room and routine-progress silence are not observed. |
| Intervene | Unproved; owned by H18 then U113. |
| Review | Unproved. |

## J2

Main: `4649c5f07822feedacbd27e3ba3adeefa49983c0` (holds U83, H18, U143; open PRs #393 U113, #396 B1–B18, #349 U134/U135, #330 F7 re-run). Same method as J1: `just harness <seed> 5199`, agent-browser, Chromium, light, 1280×800 and 700×800, all twelve seeds-by-width read with `window.__checks()`. New captures: `j2-earlier-run-*` and `j2-agents-10-*` (`.png` and `.checks.json`). The J1 captures of `first-run`, `empty-project`, `door-stopped` and `conflict` were repeated and read the same: `first-run` fails D1, D10; `empty-project` and `conflict` fail D1, D2, D10; `door-stopped` additionally fails D6 and D7 (`textarea.xterm-helper-textarea`: no hover state, no pressed state) at both widths. Nothing here ran a real Daemon, a real `claude` or the native App.

| Stage | Recorded result |
| --- | --- |
| Enter | Unproved: needs U144. |
| Request | Unproved: needs U144 for the rendered half. |
| Understand | Unproved. |
| Intervene | Unproved; owned by U113. |
| Review | Unproved: needs U144 for reopen; Room-scoped results have no contract. |

## J3

Main: `caf55898dfa1c910afe9988bd9b27978cd0ba062` (holds U144; open PRs #461 and #468 are loop machinery only). Method: `rupd <tmp project> --attached` with the fake `claude` and `RUPD_SOCKET`, then `just harness-real <project> 5199`, agent-browser (Chromium, light) at 1280×800 and 700×800, `window.__checks()` read after each step. Captures: `j3-enter-room-1280`, `j3-request-1280.png`, `j3-daemon-gone-1280.png`, `j3-review-reopen-*` (`.png`, with `.checks.json` where a Check ran). Nothing here ran a real `claude` or the native App.

| Stage | Recorded result |
| --- | --- |
| Enter | Unproved as a stage; the pointer path reaches a Thread on a real Daemon. |
| Request | Unproved: no Door action, Todo or outcome is observable. |
| Understand | Unproved. |
| Intervene | Unproved. |
| Review | Reopen of a Room and its Thread proved on the real Daemon; result inspection unproved for want of a Request outcome. |

## J4

Main: `b2a7560860cb859ec8ba44e09da03761cf5b0327` (holds U146; open PR #515 is U150 only). Method: `rupd <tmp project>` (not attached) with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude` and `FAKE_CLAUDE_ON_PROMPT='{"name":"todo_create","arguments":{"title":"$prompt"}}'`, then `just harness-real`'s Vite on port 5199, agent-browser (Chromium, light), `window.__checks()` read after each step. `u146_a_message_to_a_started_door_is_delivered_and_its_todo_shows` passes on this main (`pnpm exec vitest run src/testing/u146_door_answers.test.tsx`). Captures: `j4-request-1280.png` and `.checks.json`, `j4-review-todo-1280.png`, `j4-review-reopen-1280` and `j4-review-reopen-700` (`.png` and `.checks.json`). The Request step was captured at 1280 only. Nothing here ran a real `claude` or the native App.

| Stage | Recorded result |
| --- | --- |
| Enter | Unproved as a stage; the pointer path holds as in J3. |
| Request | Proved on the real Daemon with the fake `claude`; a real `claude` is F7's. The result is a Todo only: no Door summary exists (no method, `ui-first-journey.md` Capability paragraph). |
| Understand | Unproved. |
| Intervene | Unproved. |
| Review | Reopen proved. Finding the Door's work from its Room is unproved: no Home, no Room view. |

## J5

Main: `0a507eea270985527bfb65487b301b66c60dbbb4` (holds T12, T13, T14, U157, U158, U159; open PRs are loop machinery only). Method: `rupd <tmp project>` (not attached) with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude` and `FAKE_CLAUDE_ON_PROMPT='{"name":"todo_create","arguments":{"title":"$prompt"}}'`, then `just harness-real`'s Vite on port 5199, agent-browser (headless Chromium, light), `window.__checks()` read after each step. Captures: `j5-request-1280.png`; `j5-review-this-room-1280`, `j5-review-todo-1280`, `j5-review-reopen-1280`, `j5-review-reopen-700`, `j5-two-rooms-1280` (`.png` and `.checks.json`); `j5-door-reply-1280` and `-700` (a second `rupd` whose fake answers with `message_send {to: "you"}`). Nothing here ran a real `claude` or the native App.

| Stage | Recorded result |
| --- | --- |
| Enter | Unproved as a stage; the pointer path holds. |
| Request | Proved on the real Daemon with the fake `claude`. |
| Understand | Unproved: the Thread is not Room-scoped (U160). |
| Intervene | Unproved; owned by U113. |
| Review | Proved: the Door's work is found from its Room and again after reopen. The Door's summary when work settles (P1) has no method and is not claimed. |

## J6

Main: `b3a16d4a97d5d5acc00e7313c45e19f1b27742e5` (holds U160 and U113; open PRs #548 and #550 are other work). Method: `rupd <tmp project> --attached` with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude`, `FAKE_CLAUDE_PAYLOADS=spikes/hooks-state/log.run1.jsonl`, `FAKE_CLAUDE_EVENTS=SessionStart,PermissionRequest` and `FAKE_CLAUDE_ON_PROMPT='{"name":"message_send","arguments":{"to":"you","kind":"note","body":"done $prompt"}}'`, then `just harness-real`'s Vite on port 5199, agent-browser (headless Chromium, light, isolated session), `window.__checks()` read after each step. Captures: `j6-decision-1280`, `j6-room2-decision-1280` and `-700`, `j6-room1-decision-1280`, `j6-both-answered-1280`, `j6-room1-thread-1280` and `-700`, `j6-room2-thread-1280` and `-700` (`.png` and `.checks.json`), `j6-room1-thread.txt`, `j6-room2-thread.txt`. Nothing here ran a real `claude` or the native App. Not driven: ten Agents (J2's `agents-10` stands) and routine-progress silence.

| Stage | Recorded result |
| --- | --- |
| Understand | Unproved: selected-Room identification fails with two Rooms (U167). |
| Intervene | Answer and `working` proved on the real Daemon; the Door finishing its action after an Intervene is unobservable (U166). |
| Review | Unchanged from J5. |

## J7

Main: `83b5e7f340d1803060efa18edda9bcd4e7e4bf25` (holds U166 and U167; open PRs #614, #627, #632, #636 and #637 are other work). Method: `rupd <tmp project> --attached` with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude`, `FAKE_CLAUDE_ON_PROMPT_ASK={"tool_name":"Bash","tool_input":{"command":"echo $prompt"}}` and `FAKE_CLAUDE_ON_PROMPT={"name":"todo_create","arguments":{"title":"$prompt"}}`, then `just harness-real`'s Vite on port 5199, agent-browser (headless Chromium, light, isolated session), `window.__checks()` read after each capture. Captures (`.png` and `.checks.json`): `j7-ws1-card-1280`, `j7-ws1-settled-1280`, `j7-ws1-this-workstream-1280`, `j7-ws2-card-1280`, `j7-ws2-settled-1280`, `j7-ws2-this-workstream-1280`, `j7-ws2-thread-700`, `j7-ws3-card-700`, `j7-ws3-settled-700`, `j7-ws1-thread-700`, `j7-reopen-1280`, `j7-retry-door-1280`, `j7-agent-direct-card-1280`, `j7-agent-direct-settled-1280`, `j7-agent-todos-on-rail-1280`, `j7-agents-10-1280` and `-700`; the Threads are `j7-ws1-thread.txt`, `j7-ws2-thread.txt`, `j7-ws3-thread.txt`, `j7-reopen-ws1-thread.txt` and `j7-reopen-ws2-thread.txt`. Nothing here ran a real `claude` or the native App.

| Stage | Recorded result |
| --- | --- |
| Understand | Proved for Workstreams on the real Daemon; unproved for Agents (U176) and for ten Agents. |
| Intervene | Answer, resume and deny proved; starting a stopped Door again is unobservable (U177). |
| Review | Proved for a Door's Todos; unproved for an Agent's (U178). |

## J8

Main: `0d8310b31d68d8041af6894a405b97811156c147` (holds U176, U177 and U178). Method: `rupd <tmp project> --attached` with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude`, `FAKE_CLAUDE_ON_PROMPT_ASK={"tool_name":"Bash","tool_input":{"command":"echo $prompt"}}` and `FAKE_CLAUDE_ON_PROMPT={"name":"todo_create","arguments":{"title":"$prompt"}}`, then `just harness-real`'s Vite on port 5199 (with `RUPD_SOCKET` set), agent-browser (headless Chromium, light, isolated session `j8`), `window.__checks()` read after each capture. Captures (`.png` and `.checks.json`): `j8-ws2-card-1280`, `j8-long-decision-covered-1280` and `-700`, `j8-two-agents-1280` and `-700`, `j8-agent-selected-1280`, `j8-ws2-this-one-1280`, `j8-ws2-thread-1280` and `-700`, `j8-restarted-1280`, `j8-restarted-card-1280`, `j8-restarted-agent-1280`, `j8-agent-menu-1280`, `j8-ws1-card-1280`, `j8-ws1-settled-1280` and `-700`; the Threads are `j8-ws1-thread.txt` and `j8-ws2-thread.txt`. Nothing here ran a real `claude` or the native App. Not driven: ten Agents (J2's `agents-10` stands).

| Stage | Recorded result |
| --- | --- |
| Understand | Proved for Workstreams and two Agents on the real Daemon; ten Agents unproved. |
| Intervene | Answer by keyboard, restart and resume proved; answering a long command by pointer fails (U194). |
| Review | Proved for Todos of Workstreams and Agents; the summary is unproved. |

## J9

Main: `6f317c9f50ad4deec14d623afc7963a70560ff0d` (holds U194). Method: as J8 (`rupd <tmp project> --attached`, `RUPD_SOCKET`, the fake `claude`, `FAKE_CLAUDE_ON_PROMPT_ASK={"tool_name":"Bash","tool_input":{"command":"echo $prompt"}}`, `FAKE_CLAUDE_ON_PROMPT={"name":"todo_create","arguments":{"title":"$prompt"}}`, `just harness-real`'s Vite on port 5199, agent-browser headless Chromium, light, isolated session `j9`, `window.__checks()` read after each capture). Two Workstreams, five Agents added by `+ agent` to each. Captures (`.png`, and `.checks.json` where a Check ran): `j9-ten-agents-1280` and `-700`, `j9-mixed-1280`, `j9-ws1-this-one-1280`, `j9-ws2-this-one-1280`, `j9-long-decision-700`, `j9-long-answered-1280`, `j9-restarted-1280` and `-700`. Nothing here ran a real `claude` or the native App.

| Stage | Recorded result |
| --- | --- |
| Understand | Ten Agents in two Workstreams on the real Daemon: `needs-you` and `idle` proved; the other Kinds unproved: needs **U351**. |
| Intervene | Proved: Intervene by pointer on a long command. |
| Review | Proved for the Todos of two Workstreams, their Agents and a restart. |

## J10

Main: `5490d16d4f81ec6abf2531c55a811734b347b9db` (holds U351 and #836). Method: as J9 (`rupd /tmp/j10/proj --attached` with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude`, `FAKE_CLAUDE_KINDS` of `working, idle, needs-you, working, idle` for the first Workstream and `error, needs-you, working, error, needs-you` for the second, `FAKE_CLAUDE_ON_PROMPT` a `todo_create`, `just harness-real`'s Vite on port 5199, agent-browser headless Chromium, light, isolated session `j10`, `window.__checks()` read after each capture). Two Workstreams, five Agents added by `+ agent` to each, then a Terminal by `+ terminal`. Captures: `j10-ten-1280`, `j10-ten-700`, `j10-jump-error-1280`, `j10-terminal-1280` and `-700`, `j10-restarted-1280` (`.png`, and `.checks.json` where a Check ran). Nothing here ran a real `claude` or the native App.

| Stage | Recorded result |
| --- | --- |
| Understand | Ten Agents in every Kind but `blocked` in two Workstreams, the jump and `done` proved; `blocked` unproved: needs **A33**. |
| Intervene | Proved in J9 on the earlier main; the `error` row's action is owned by the Intervene scenarios, not claimed here. |
| Review | Proved for the Todos of two Workstreams. |

## J11

Main: `83809015bd82e4f4099e88e0a2d7f2ada04427fa` (holds A33). Method: as J10 (`rupd /tmp/j11/proj --attached` with `RUPD_SOCKET`, `ROUNDUP_CLAUDE_BIN` the fake `claude`, `FAKE_CLAUDE_KINDS` of `idle, working, needs-you, working, idle` for the first Workstream and `error, needs-you, working, error, needs-you` for the second, `FAKE_CLAUDE_AGENT_TOOLS` of `todo_create blocker` then `todo_create waiting` with blockers `[1]`, `FAKE_CLAUDE_ON_PROMPT` a `todo_create`, `just harness-real`'s Vite on port 5199 with the same `RUPD_SOCKET`, agent-browser headless Chromium, light, isolated session `j11`). The first Agent is `idle` in `FAKE_CLAUDE_KINDS` because `blocked` is only read from an `idle` Agent. Two Workstreams, five Agents added by `+ agent` to each. Captures: `j11-ten-1280`, `j11-ten-700`, `j11-jump-error-1280`, `j11-blocked-1280`, `j11-workstream-todos-1280`, `j11-collapsed-1280`, `j11-restarted-1280` and `j11-restarted-expanded-1280` (`.png`, and `.checks.json` where a Check ran). Nothing here ran a real `claude` or the native App.

| Stage | Recorded result |
| --- | --- |
| Understand | Ten Agents in every Kind in two Workstreams, the jump and `done` proved; a second `blocked` Agent and a Workstream collapsed over `blocked` unproved: needs **U356**. |
| Intervene | Proved in J9 on the earlier main. |
| Review | Proved for the Todos of two Workstreams. |

## J12

Main: `2b0cf1e19c005980a3f7f6b33bb171ee4889876a` (holds U356). Method: the real `rupd` with the fake `claude`, as `u356_` starts it (`FAKE_CLAUDE_KINDS` of `blocked, working, idle, working, idle` for the first Workstream and `error, needs-you, blocked, error, needs-you` for the second, `FAKE_CLAUDE_ON_PROMPT` a `todo_create`), `just harness-real`'s page at `harness.html?daemon=1`, headless Chromium on a fresh profile through `chromePage` (never the user's browser), light, 1280×800 and 700×800. Both Workstreams and all ten Agents were started by pointer; `window.__checks()` was read in each capture. Captures: `j12-ten-1280`, `j12-ten-700`, `j12-jump-1280`, `j12-collapsed-1280`, `j12-collapsed-700` and `j12-workstream-todos-1280` (`.png` and `.checks.json`). The driver was a throwaway test and is not kept. Nothing here ran a real `claude` or the native App.

| Stage | Recorded result |
| --- | --- |
| Understand | Proved: ten Agents in the five Kinds `blocked`, `working`, `idle`, `needs-you` and `error` (no `done` row was rendered), two `blocked`, in two Workstreams, the Workstreams collapsed and the jump. |
| Intervene | Proved in J9 on the earlier main. |
| Review | Proved for the Todos of two Workstreams. |
