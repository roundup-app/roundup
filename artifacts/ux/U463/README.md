# U463 first-run to a real Thread

Observed source: `b74f1301e8a8d864e1e881a63b5c3149f985f37d`, including main `ed4d47f1`. Generated with `just capture U463`: isolated headless agent-browser sessions, fresh profiles and temporary Projects, real `rupd`, fake `claude`.

```text
first-run → choose folder → configured Project → New Workstream (starts Door) → Thread
Hide Shelf → send “u463 real request” → Show Shelf → Daemon-created Todo
cancel next choice → choose folder → first-run, no work → choose again → Project
```

Keyboard and pointer run at both 1280×800 and 1440×800. All 36 complete Check readings pass D1–D14 and D16, including D2, D5 and D6; there are no pre-existing failing Checks in these observations. The observer hides U371's floating Shelf before sending and reopens it to observe the Todo.

Each `*-choose-thread.rpc.json` records the real Tree, Terminals, Messages, Todos and browser RPC calls. In each Choose observation, the selected Workstream and its Door Terminal are `1`; `u463 real request` is delivered to that Door and creates the visible Todo. Cancellation leaves `rail.tree` and `terminal.list` empty; the next choice opens the configured path. Default-mode cases retain the already-open Project and null chooser; a different path is rejected.

| Observation | 1280×800 | 1440×800 |
| --- | --- | --- |
| First-run | [keyboard](1280-keyboard-choose-first-run.png) | [pointer](1440-pointer-choose-first-run.png) |
| Thread, Shelf closed | [keyboard](1280-keyboard-choose-thread-shelf-closed.png) | [pointer](1440-pointer-choose-thread-shelf-closed.png) |
| Request outcome | [keyboard](1280-keyboard-choose-thread.png) | [pointer](1440-pointer-choose-thread.png) |
| Cancellation | [keyboard](1280-keyboard-cancel-cancelled.png) | [pointer](1440-pointer-cancel-cancelled.png) |

The configured chooser result is simulated. The native folder chooser, native App and real `claude` are outside this browser observation.
