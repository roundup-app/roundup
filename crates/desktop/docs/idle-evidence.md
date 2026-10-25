# R24 App evidence producer

This is #3862's prerequisite for #3844, not an idle observer or a native measurement.
It leaves R17/R18 scheduling, ADR 0001, budgets and production cursor blink unchanged.
No native validation or CPU/wake-up result follows from its tests.

## Build and launch contract

The parent first enforces R24's authorization/host guards, release prerequisite and
N7 isolation/owned-child cleanup. Build the same binaries once for both Agent counts:

```sh
VITE_ROUNDUP_IDLE_PERF=1 pnpm --filter desktop build
cargo build --release -p desktop --features custom-protocol,idle-perf
cargo build --release -p rupd -p rup
```

Normal web builds omit `VITE_ROUNDUP_IDLE_PERF`; normal native builds omit
`idle-perf`. No permission or capability is added. The only measurement command,
`record_idle_evidence`, accepts a typed record from the invoking main webview;
it accepts neither JavaScript nor a destination path. The native owner evaluates
one fixed shutdown checkpoint expression; no external evaluation seam exists.

On the authorized Mac the parent launches `roundup <temporary-project>` with:

| Environment | Requirement |
|---|---|
| `ROUNDUP_ALLOW_WINDOW` | Exactly `1` |
| `ROUNDUP_DATA_DIR` | Fresh temporary App data/profile, as in existing perf runs |
| `ROUNDUP_IDLE_EVIDENCE_DIR` | Private, run-owned directory already created by the parent |
| `ROUNDUP_RUPD_BIN` | The release Daemon built above |
| Fake vendor setup | Existing isolated fake executable/PATH and settings arrangement; never a real vendor |

The feature build refuses missing gates and non-macOS hosts before constructing
its window. It creates `app-idle.jsonl` exclusively (mode 0600), refusing an existing
file, including a symlink. The parent owns the directory, process, evidence retention
and cleanup. Redirect and retain stderr too. Never point these variables at personal data.

The parent discovers the App's Daemon using existing contracts, creates its ten idle
Agents and observes authoritative Status and output through those contracts. The App
selects the first Agent with a Terminal once, through production `rail.select`, and
renders it through the ordinary Pane/Screens/xterm paths. It starts no Agent, writes
no Terminal input and runs no typing/frame driver, even if their build flags were
also supplied. Keep this selected Agent alive while reducing ten Agents to one;
stop and remove the other nine through `agent.stop` and `rail.remove`, then
verify the surviving one-Agent Rail and authoritative idle Status. The parent must verify
the selected Project/Terminal identity, renderer and dimensions remain equal in
both counts, and reject any mismatch rather than substituting another Terminal.
No always-on-top or App Nap override is applied. A normal focused Terminal uses its
ordinary cursor blink; native focus is an observed state, not forced by this producer.
The parent’s isolated fake vendor must print the standard blinking-block cursor
sequence `ESC [ 1 SP q` once during setup (before the no-output interval), as an
ordinary vendor Terminal would. xterm's production parser handles it; the producer
never changes xterm options or injects this as Terminal input. Retain that setup
output and confirm cursor-enabled focused rendering in the later native round.

## Stream schema (version 1)

Each flushed line is one complete JSON object:

```json
{"v":1,"seq":3,"at_us":18000,"source":"application","body":{"cause":"NSApplicationDidHideNotification","hidden":true}}
```

`seq` starts at 1 and increases by one across **all** native receipts, serialized
under one lock. `at_us` is monotonic microseconds since this producer started,
read under that same lock; equal timestamps are valid. It is neither Unix time nor
the renderer clock. Correlate the `start` receipt with the observer's monotonic
launch/receipt bounds; retain that uncertainty. Never equate these clock origins.
A restarted App uses a fresh directory/file, never the earlier sequence lifetime.

| `source` | `body` |
|---|---|
| `start` | App `pid`; first receipt |
| `native` | `cause`, queried native `focused`, `visible`, `minimized`, physical inner `width`/`height`, `scale` |
| `window-event` | Actual event payload: `focused`, physical `width`/`height`, or `scale` with dimensions |
| `application` | AppKit notification `cause` and actual `hidden`; also an initial `NSApplication.isHidden` snapshot |
| `webview` | Renderer record below |
| `checkpoint` | `web_seq`: renderer sequence acknowledged at orderly shutdown |
| `end` | App exited; after shutdown checkpoint on success |
| `error` | Explicit collection failure text; invalidates evidence |

Tauri supplies initial/query snapshots and native focus/resize/scale events.
AppKit supplies hide/unhide notifications synchronously, including hide of an
already unfocused App. `native.visible` is the window query, not a claim about
AppKit hide, occlusion or **webview** visibility. Application hiding and the
webview document's visibility are separate facts. A hide request is never a receipt.
No endpoint comparison replaces the retained event payloads.

A `webview` body has `seq` (separate renderer sequence starting at 1), `at_ms`
(`performance.now()` at the event, before IPC), `cause`, `visibility`
(`visible`/`hidden` from `document.visibilityState`), `focused` (`document.hasFocus()`),
nullable `project` and `terminal` identities, nullable `renderer` (`webgl`/`dom`),
and viewport CSS `width`/`height`. Renderer identity follows the selected Terminal,
including WebGL context-loss fallback. Causes are `initial`, `selection`, `renderer`,
`visibility`, `focus`, `resize`, and `collection-lost`. Null selection/renderer is
unknown, never a valid focused workload. The native sink refuses missing/reordered
renderer sequences and invalid timestamps. It appends a native query after each
renderer receipt, without changing the meaning of that earlier renderer timestamp.

Listeners stay attached through setup, settling and sampling. Every observed
transition is queued before asynchronous delivery; a transient hidden/selection
change is retained even when the ending snapshot matches the starting snapshot.
There is no collection polling timer. At orderly App quit, the native owner prevents
exit once and reads the fixed webview checkpoint. It requires nonzero matching
sequence, zero pending records and no renderer error, then records `checkpoint`
and exits. Reading this final checkpoint detaches the webview evidence listeners;
the collection interval ends there, before webview destruction. Missing/unresponsive checkpoints fail after a three-second shutdown-only
deadline. After the final sample, unhide the App to drain suspended delivery, then quit it
normally; killing it provides no complete journal. Keep those later transitions
in the stream with their timestamps rather than deleting them.

## Consumer refusal rules

The parent tails complete lines while retaining partial trailing bytes until the
next read. It must preserve **all** records across settling and sampling and apply
R24's own phase comparison; this producer decides no numeric pass.

Refuse a missing initial native, application or webview snapshot, missing actual
visibility, unknown selection/renderer, any `error`/`collection-lost`, a sequence
gap/reset, invalid time, or missing final matching `checkpoint` and `end`. A missing
or partial final line, App death, absent file or acquisition timeout is collection
loss. Set finite observer deadlines; a quiet file alone proves no liveness.
Native and renderer clocks and IPC receipt times must not be silently conflated:
if a delayed event's timing cannot exclude an invalid transition from the sample,
that phase is unknown and must be refused.

The journal stops at 8 MiB, reserving room for an explicit limit-error line.
The renderer bounds pending IPC records at 256, reserving one loss receipt; its
renderer-identity cache is bounded at 256 too. Overflow never drops an old event
and continues as though complete. A write/flush failure stops the sink and returns
an error; stderr and the missing completion proof remain failure evidence even
when the failed destination cannot hold its own error. No missing value means zero.

After this producer merges, #3844 must name its completed implementation commit
in its separate native measurement work order. This prerequisite requests no Mac run.
