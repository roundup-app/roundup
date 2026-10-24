# Terminal output streams

Module: `crates/terminal`; the Terminal event path in `crates/rupd` and
`crates/desktop`; the Terminal output contract and App output subscription.

**X14 output belongs to one Terminal.** Given a Project with several Terminals,
a client subscribes only to the output of the Terminals it displays. The following
clauses specify the implementation; their new `x14_` tests are required acceptance,
not tests claimed to exist in this specification PR.

1. **Isolation.** Given subscribers for Terminals A and B and one global event
   subscriber, when A prints more chunks than the global Bus capacity while B
   prints a marker, then A's subscriber receives only A's bytes in order, B's
   receives only B's marker, and the global subscriber receives no output bytes
   and no output-induced `RecvError::Lagged`. Terminal title, exit and Rail events
   remain on the global event stream. Test: `x14_output_is_isolated_from_other_terminals_and_the_bus`
   in `crates/terminal/tests/` and `x14_socket_output_is_selected_by_terminal`
   in `crates/rup/tests/` (real Daemon, two clients with different selections).
2. **Raw App transport.** Given bytes including NUL, ESC, invalid UTF-8 and a
   multibyte character split between chunks, when they cross the desktop output
   subscription, then the Tauri `ipc::Channel` receives raw bodies and the webview
   receives `ArrayBuffer` values whose concatenated bytes equal the original
   bytes. No base64 string, JSON byte array or text decoder carries this payload.
   Terminal identity and byte offsets belong to subscription/control metadata;
   each raw payload belongs to exactly one selected Terminal. Tests:
   `x14_desktop_output_channel_uses_raw_bodies` in `crates/desktop/tests/` probes
   the actual Tauri response body; `x14_app_writes_channel_bytes_to_xterm`
   in `apps/desktop/src/terminal/` asserts the exact `Uint8Array` passed to xterm.
3. **Attach and recovery.** Given output arriving during attach, when the App
   installs a subscription and obtains `terminal.snapshot`, then snapshot bytes
   through `Snapshot.after` and later stream bytes render once, in order, with
   neither a gap nor a duplicate. A slow output subscriber never blocks the PTY
   reader or another Terminal. Overflow is reported for that subscription with
   enough offset information to detect a gap; the App obtains a fresh snapshot
   and resumes after its offset instead of silently joining discontinuous bytes.
   Tests: `x14_attach_reconciles_snapshot_and_live_offsets` and
   `x14_lag_recovers_only_the_affected_terminal` in `crates/terminal/tests/`,
   plus `x14_app_recovers_a_gap_without_repeating_output` in
   `apps/desktop/src/terminal/` through the subscription boundary.
4. **Subscription lifetime.** Given a displayed Terminal, when its pane is
   disposed, its Project disconnects, or its selection is replaced, then its
   output subscription is released and late callbacks cannot write to the disposed
   or replacement xterm. Other subscribers remain active. An unknown Terminal
   is `NOT_FOUND`; resubscribing to an exited Terminal retains X8's `NOT_FOUND`.
   An attached subscriber receives the final bytes before exit completes, and
   Terminal close releases its stream resources. Tests:
   `x14_app_disposal_releases_only_its_output_subscription` in
   `apps/desktop/src/terminal/` and `x14_output_subscription_lifetime`
   in `crates/terminal/tests/` and `crates/rup/tests/`.
5. **One parser implementation.** Given CSI cursor movement/erase, OSC split
   across chunks, carriage-return redraw, split UTF-8 and invalid bytes, when
   `terminal.screen`, `terminal.read` and `terminal.search` run, then plain text
   is produced by the existing `vt100` parser implementation, with no second
   escape-state machine or handwritten UTF-8 decoder. The Output log may retain
   raw bytes and offset bookkeeping; replay uses the same library and preserves
   X13's incremental byte-offset, cap, truncation, search and read-only guarantees,
   including an evicted prefix. `terminal.output` names the byte stream;
   `terminal.read` and `terminal.search` are the existing plain-text RPCs.
   Test: `x14_plain_text_uses_vt100_with_chunk_and_eviction_boundaries`
   in `crates/terminal/tests/`; existing X13 tests remain required. Policy:
   independent review inspects the removal of `output.rs`'s `Escape`, `lines`
   parser and `decode`; multiple instances of the library parser are permitted.
6. **Caller migration.** Policy: the implementation follows the Contract recipe
   (rule 4), updates every producer and consumer, regenerates `contracts/generated/`
   from `crates/contracts`, records new public names in `GLOSSARY.md`, and probes
   each new type and method. X14 supersedes only X1/X2's global base64-output
   transport and X13's reference to output *events*; their byte content, ordering,
   offsets and all other guarantees remain. `terminal.write` input encoding is
   unchanged. Agents' in-process subscriptions, Run capture, MCP reads and
   performance clients migrate in that same Contract PR. No Message or Route
   semantics change. Test:
   `x14_all_output_callers_use_selected_streams` in `crates/rup/tests/`
   exercises the real Daemon and Run/MCP paths, alongside existing X1–X13 tests.
7. **Flood observer.** Given a real isolated Daemon and ten Terminals running
   `yes`, when an observer pauses a Rail event receiver until each Terminal has
   produced more output chunks than the global Bus capacity, then resuming that
   receiver yields every deliberately emitted Rail marker, no Terminal payloads
   and zero `Lagged` errors. Drain output independently; keep Rail markers below
   Bus capacity so they cannot overflow it themselves. Stop all ten processes
   and close only this fixture's resources on success or failure. Test:
   `x14_ten_busy_terminals_do_not_lag_rail_events` in `crates/rup/tests/`.
   Policy: retain the same real-Daemon flood observation with `just perf`, reporting
   per-Terminal chunk counts, Rail markers and lag count, not merely absence of
   stderr. Existing `just perf` has no flood switch: observer integration outside
   the owned Terminal path requires a scoped prerequisite Issue, never a silent
   ownership expansion or a claim that today's idle workload proves this clause.
8. **Regression and journey.** Policy: run all `terminal.md` scenarios, X11/X12,
   RPC and Daemon regressions, and `just check origin/main`. Report matched
   before/after `just perf` values with source/binary hashes, commands, exits,
   host/toolchain/profile and loads, as unqualified evidence. Preserve
   `docs/perf.md`'s absolute limits and 10% regression gates. R16 machine-class
   qualification is not required; skipped latency comparisons do not
   demonstrate acceptance. Report `write_to_output_p95_ms` explicitly as the
   headless Daemon bound, never as full keystroke-to-render. Preserve R11/R12's
   native WKWebView observation and consent requirements; any required native
   measurement uses that observer and reports before/after p95 and renderer.
   No baseline, noise allowance or workload is relaxed. In isolated headless
   browser sessions at 1512×950, observe the journey's Understand
   and Intervene stages: switch between two live Terminals, type into the selected
   one and see its echo while ten others print, with Status and Decision updates
   still delivered. Test: `x14_selected_terminal_echo_and_rail_updates_survive_output_flood`
   in `apps/desktop/src/terminal/`. Policy: preserve D2, D5 and D6 and every
   Check passing on main; retain rendered results under the harness rules.

**X16 a reader reads only what is new, as plain text, at most 200 lines.** Narrows X13's
`terminal.read` and adds no stream (X14 owns it). A read is never answered with output the same
reader already received, so a Door that polls a Terminal cannot act twice on one line. Related B19
and B20: the Digest never reads Terminal output and stays as they say; this cursor serves only
`terminal.read`. Contract change (rule 4): `ReadParams` gains `reader`, and `after` becomes optional.

1. **Cursor.** Given `terminal.read {id, reader}` with no `after`, the Daemon reads from that
   reader's cursor for that Terminal (the log's start for a reader's first read), returns the result,
   and sets the cursor to the reply's `next`. Each `(reader, Terminal)` pair has its own cursor, so a
   second reader's first read begins at the log's start whatever the first has read. `rup mcp` and
   `rup terminal read` fill `reader` with the caller's Agent id (I5). A call with `after` reads from
   `after`, as X13 says, and leaves every cursor as it was. A call with neither `after` nor `reader`
   is `INVALID_PARAMS`. A cursor older than the log's start begins at the log's start (X13); a cursor
   ends with its Terminal (`terminal.close`). Tests: `x16_the_second_read_is_only_the_delta`,
   `x16_readers_have_separate_cursors`, `x16_a_read_with_after_leaves_the_cursor`,
   `x16_a_read_with_no_reader_and_no_after_is_refused`.
2. **Plain text.** Given a fake Terminal printing lines wrapped in colour codes (`ESC[31m`, `ESC[0m`,
   `ESC[38;5;196m`), the text of every read holds none of the bytes `ESC` (0x1b) and no `[31m` remnant,
   and holds the words printed (X13.2). Test: `x16_a_read_holds_no_escape_byte`.
3. **Line cap.** A reply holds at most 200 lines and still X13.3's 16 384 bytes, whichever is
   reached first; when lines remain `truncated` is true and `next` is the offset of the first line
   not returned, so the next read from the cursor starts there with no line missed and none repeated.
   A `max` may only lower the byte cap and no request raises the line cap. Tests:
   `x16_a_read_returns_at_most_200_lines_and_the_next_read_continues`,
   `x16_the_line_cap_loses_and_repeats_no_line`.
4. **Reads change nothing else.** As X13: no byte is written, and no event is emitted. The
   cursor is Daemon state only and appears in no Digest (B19, B20). Test:
   `x16_a_read_emits_no_event_and_the_digest_holds_no_terminal_text` (a fake Terminal printing
   `ZEBRA`, read by the Door, leaves it out of `agent.digest`).

Tests are `x16_` in `crates/terminal/tests/` (a fake Terminal printing coloured lines) and
`crates/rup/tests/` (the real Daemon, the reader taken from the Agent id). Observer: `just check`.
Policy: the 200-line cap is a number chosen here; a later scenario changes it.

## Checks on main

These are existing anchors, not evidence that X14 is implemented:

1. `crates/terminal/src/lib.rs`, `Shared::publish` sends a Terminal event both to
   its own receiver and the Bus; `Terminals::subscribe` supplies per-Terminal receivers.
2. `crates/terminal/tests/scenarios/in_process.rs`,
   `x8_a_slow_subscriber_never_blocks_the_reader` asserts bounded subscriber lag.
3. `crates/terminal/tests/scenarios/read.rs`,
   `x13_read_from_next_returns_only_what_is_new` and
   `x13_read_older_than_the_log_starts_at_the_log_start` assert incremental history.
4. `justfile`, `perf` and `perf-keystroke`, and `docs/perf.md`,
   “Keystroke-to-render in WKWebView”, distinguish Daemon and native measurements.

## Reuse

Policy: reuse the existing per-Terminal Tokio broadcast and Tauri raw IPC
capabilities before adding machinery. [Tokio broadcast](https://docs.rs/tokio/1.53.1/tokio/sync/broadcast/index.html)
provides bounded fan-out and explicit lag reporting; its
[1.53.1 release](https://github.com/tokio-rs/tokio/releases/tag/tokio-1.53.1)
was published 2026-07-20.
[Tauri Channel](https://docs.rs/tauri/2.12.1/tauri/ipc/struct.Channel.html) with
[Response](https://docs.rs/tauri/2.12.1/tauri/ipc/struct.Response.html) supplies raw
IPC bodies; its [2.12.1 release](https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.12.1)
was published 2026-09-30. These libraries cover different boundaries and are
selected together. [vt100 0.16.2](https://docs.rs/vt100/0.16.2/vt100/struct.Screen.html)
provides screen/scrollback contents; its
[changelog](https://github.com/doy/vt100-rust/blob/main/CHANGELOG.md) records the
2025-07-11 release. Select the existing parser implementation rather than another
parser. Implementation PR evidence must verify byte-offset replay and raw IPC
against the installed versions; this specification introduces no custom machinery.

## Validation results

Policy: record each failed command/assertion on the Work Issue, one row per
failure with the actual exit code and repair. No observer failure proves acceptance.

| Failure | Exit code | Result |
|---|---|---|
| Required X14 test is missing | not run | Implementation acceptance remains unmet |
| X14 or regression assertion fails | 1 | Implementation acceptance remains unmet |
| `just check origin/main` gate fails | 1 | Required checks remain unmet |
| `just perf` absolute or regression miss | 1 | Performance acceptance remains unmet |
| Perf executable cannot qualify its observer | 2 (recipe returns 1) | No valid measurement |
| Required latency comparison skipped | 0 | No complete regression observation |
| Flood fixture cannot start or collect counters | actual nonzero exit | No flood observation |

Policy: the specification Issue closes on this acceptance document and its
validated dependent implementation work order. Only that dependent Issue owns
implementation completion; this document alone proves no runtime acceptance.

R2965 observer requirement for X14: `x14_flood_leaves_rail_events_unlagged_and_cleans_up`: ten real PTYs flood while Rail markers travel on the actual Bus, followed by process cleanup. In-memory chunks cannot reveal PTY reader starvation or surviving flood children.

R2965 observer requirement for X14 library capability: `x14_library_screen_edit_observation_survives_checkpoint_replay` and `x14_library_screen_restore_state_is_bounded`: isolated child address spaces sample RSS after 1 and 64 MiB of parser input. Shared test-process RSS includes unrelated tests and cannot detect retained parser storage reliably. Parser replay assertions themselves stay in-process.
