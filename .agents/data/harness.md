# Harness

Data for the QA sweep and the Design critic.

`just harness <seed> <port>` (defaults `tree-40`, `5199`, strict port) serves the App on a fake Daemon at `http://localhost:<port>/harness.html?seed=<seed>` (U26). It checks no Route, Block or Provenance and says nothing about macOS rendering or timing: read the DOM, never the numbers.

| Seed | Starts with |
|---|---|
| `first-run` | no open Project |
| `empty-project` | open Project with no rows; U143’s first Workstream action |
| `door-stopped` | selected Workstream whose Door exited 0; U143’s state and restart action |
| `thread-report` | selected Workstream `workstream-1` with a three-line order, a note, a question with `**` and the user’s answer; U197’s one column |
| `pinned-question` | selected Workstream `workstream-1` whose order is a 12-line clarifying question; U354’s pinned question |
| `decisions` | `agents-10`, `agent-1` selected, with a permission, an `ask_user` and an unanswerable Decision on `agent-1` to `agent-3`; answering clears it |
| `earlier-run` | selected `done` Agent with no Terminal; U83’s `no output kept from an earlier run` |
| `agents-10` | ten Agents, one per Kind in turn |
| `tree-40` | forty nodes (nested Workstreams, a Door, Terminals), eight Todos, four Pads |
| `daemon-exits` | `agents-10`, then `daemon-exited` with code 1 |
| `tabs-8` | eight Projects, `agents-10` in the first; a needs-you Agent in the second and an error in the eighth (U184) |
| `conflict` | `agents-10`; the first call fails with `CONFLICT` |
| `bubbles` | an Agent with one running and one exited Run, a Workstream with one Terminal, one bubble minimised (U164) |

`just harness-real <project-path> <port>` (U144; default port `5199`) serves the same App on a running `rupd` at `http://localhost:<port>/harness.html?daemon=1`: the dev server relays `rpc` and `subscribe` over the socket `rpc::socket_path` names (`RUPD_SOCKET` if set), the choosers answer `null`, and `daemon-exited` fires when the socket closes. It listens on loopback only, has no `window.__fake`, and `vite build` leaves it out. Start `rupd` first; the proof it answers is `ROUNDUP_REAL_PROOF`, else 64 zeros as the end-to-end tests start it. Start `rupd` with `FAKE_CLAUDE_ON_PROMPT` (U146; `crates/rup/tests/e2e/fake_claude.py`) set to a JSON tool call and a Door answers each Message typed to it: `UserPromptSubmit`, the call with `"$prompt"` replaced by the typed text, `Stop`. It proves the webview against the real Daemon, never WKWebView, the native chooser or a real `claude`.

`window.__fake` (drive with `agent-browser eval`):

| Call | Sends |
|---|---|
| `setStatus("agent-3", "needs-you", "asks: keep v1?")` | `agent.status` |
| `writeOutput("t-agent-3", "hello\r\n")` | `terminal.output`; visible only once that Agent is selected |
| `emit({actor: {kind: "user", id: "you", parent: null}, name: "rail.changed"})` | any Event |
| `failNext(-32003, "name already taken")` | the next call rejects |
| `app.exitDaemon({code: 1})` | `daemon-exited`; `app.calls` lists every call |

`window.__checks()` (U137) runs D1 to D14 on the screen. `agent-browser`: one session name per agent, `set viewport 1512 950` (the only viewport, `.agents/data/journey.md`), single key events via `eval` (after `press Enter` a key may repeat; count keydowns first).

## Held-out screens

No Builder prompt lists these.

- `tree-40`, 1512x950, dark, the Todo Drawer open on `#5`.
- `agents-10`, 1512x950, light, `prefers-contrast: more`.
- `tree-40` with a 60-character Agent name (U29), 1512x950, dark.
- `first-run`, 1512x950, dark.
- `conflict`, 1512x950, light, a Pad Drawer open.

## Rules the Checks do not cover

| Rule | Passes when |
|---|---|
| R1 | the Live line shows only for blocked, needs-you, error, hover or selection |
| R2 | the provenance letter shows only on hover or selection |
| R3 | each duration is within 25% of `docs/motion.md`; a Status Glyph change is instant; nothing snaps (covers its whole displacement between two `requestAnimationFrame` samples, so a clause of 120 ms or more needs two frames between); reduced motion leaves only the instant ones; drag unscored |
| R4 | no string the app itself writes holds an _Avoid_ word, and each domain noun is its `GLOSSARY.md` term; `scenarios/ui.md`'s strings are exempt |

## Captures

`artifacts/ux/<id>/<step>.png` and `<step>.checks.json`; motion: `<step>-frames.json` and at most five `<step>-NN.png`; baselines `artifacts/ux/<id>/base/` and `head/`, compared by `loop/rules.sh delta base head` (L42; exit 2 is a failed run). Linux and macOS captures are never compared. Captures are dark mode only.

Images and videos are never committed (`.gitignore` skips them under `artifacts/ux/`): a build or fix run leaves its captures under `artifacts/ux/` and the workflow attaches them to the PR after the run (`builder.py attach`, `gh pr edit <n> --attach`, 50 files per command) with the repository secret `PR_ATTACH_TOKEN`, which the model never holds; a missing secret fails that step and leaves the PR and Issue as they are. Readings (`*.checks.json`, `*-frames.json`) are small JSON and may be committed. A design-critic run holds a read token: its captures stay in its checkout and it attaches nothing.

## Tests that race

A test waits on the state it reads, with a bounded failure; it never waits on a fixed sleep or a padded timeout (L122). `check`'s `new-tests-stress` job runs every test a PR adds or edits 20 times under CPU load with no retry, and fails it as "flaky under load: <test>". Fix the wait: raise no timeout and add no retry. A test merged earlier that passes only on its retry appears under "Flaky" in its lane's job summary.
