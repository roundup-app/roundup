# Terminal socket allocations

Acceptance for #5638. Implementation ownership: `crates/rupd/src/output.rs`,
`connection.rs`, `route.rs` and their unit tests. Target 250–450 changed lines.
This specification changes no behavior; implementation remains a separate run.

## Checks on main

1. Output envelopes and bounded delivery: `crates/rupd/src/output.rs`, `forward`,
   `Port::select`, `Port::release`, `Selected::drop`, `PENDING_FRAMES`.
2. JSON frames, newline framing and reply priority: `crates/rupd/src/connection.rs`,
   `Frame::into_line`, `handle`.
3. Parsed request ownership, replies and notifications: `crates/rupd/src/route.rs`,
   `Daemon::dispatch`, `Daemon::dispatch_parsed`, `Daemon::route_inner`.
4. Caller identity and authorization: `crates/rupd/src/guards.rs`,
   `Daemon::terminal_writer`, `Daemon::guard_terminal_read`, `Daemon::guard_terminal`;
   `crates/agents/src/reach.rs`, `Agents::write_terminal`;
   `crates/rupd/src/tests.rs`, `r3696b_write_classifies_its_caller_once`.
5. Existing envelope proofs: `crates/rupd/src/tests.rs`,
   `r16_frames_preserve_complete_error_envelopes`,
   `r16_notifications_do_not_add_frames_between_pipelined_replies`;
   `scenarios/terminal-stream.md`, X14 output belongs to one Terminal.
6. Installed serialization: `crates/rupd/Cargo.toml`, dependencies;
   `Cargo.toml`, workspace dependencies (`serde` derive and `serde_json`).
7. Performance interpretation: `docs/perf.md`, What is enforced, and what is not;
   `scenarios/perf-macos-write.md`, R3696b one classification per write.

## Acceptance

The tests below are planned implementation observers, not claims of passing tests
on main. Each lives under `output::`, `connection::` or `route::` in the `rupd`
library, so the command below selects every new acceptance test.

**R5638a output frames preserve bytes and metadata.** Given an 8 KiB byte chunk
containing all byte values, NUL, ESC, invalid UTF-8 and split multibyte UTF-8, with
nonzero offset and a Terminal id containing Unicode, quotes, backslash, newline,
tab and NUL, when the production output framing path writes it as a line, then
Serde parses exactly one JSON object with `jsonrpc: "2.0"`,
`method: "terminal.output"` and `params` containing exactly the original `id`,
`offset` and standard-base64 `data`; decoding `data` reproduces every byte.
There is no RPC `id` on this notification. Planned
`r5638a_output_line_preserves_bytes_and_metadata` checks the decoded object,
decoded payload and exactly one terminating newline, with no literal newline
inside the JSON text. Planned `r5638a_gap_line_preserves_range` applies the same
framing and escaping assertion to `terminal.gap`, preserving `id`, `from` and `to`
for a nonempty gap, including offsets above the exact-integer range of f64.

**R5638b output framing allocates less.** Given the prepared 8 KiB fixture from
R5638a, when allocation counting encloses the production operation from borrowed
Terminal id and chunk through the complete newline-terminated frame, then its
allocated bytes are strictly below the old path for the same input and output.
Planned `r5638b_output_framing_allocates_less_than_value_envelope` asserts that
comparison and equal decoded frames. The old-path reference reproduces Check 1's
`json!` envelope, owned id and encoded-data copies, followed by Check 2's
`Frame::Value` line serialization; it does not add artificial copies.

Policy: production serializes a borrowed envelope through installed Serde into
`Frame::Json`. Neither bytes nor gaps build a generic `Value`/Map envelope tree;
Terminal ids are borrowed while serializing and encoded data is not copied into
a temporary JSON tree. Base64 and the socket writer's newline remain unchanged.
Review the implementation for these structural requirements, rather than adding
a test that rereads Rust source.

**R5638c dispatch consumes params without full payload clones.** Given a parsed
`terminal.write` request whose valid base64 `data` is exactly 1,048,576 encoded
bytes, when an authorized write is dispatched through `Daemon::dispatch_parsed`,
then the decoded 786,432 bytes reach the write-effect seam once and the success
reply retains its request id. Planned
`r5638c_dispatch_consumes_large_write_without_payload_clones` asserts exact bytes,
one effect and success, and compares allocated bytes with the old dispatch path.
The new path saves at least `2 * 1,048,576 - 4096` allocated bytes: both old
full-size params copies, allowing 4 KiB for fixed overhead differences.
The old-path reference reproduces Check 3's request-params clone and pre-decode
Terminal-params clone with otherwise identical guards, decoding and effect seam.

Policy: move owned params out of the parsed request once, retain borrowed access
for existing decisions, then consume params for typed decode. Keep authorization
and validation order. Do not change `crates/rpc` parsing, add/remove a cache, add
a parser/serializer, or replace dispatch with a test-only successful decoder.
Use the existing in-memory Terminal input support or a private frame/dispatch
seam within ownership; no real PTY, child program or public RPC is added.

**R5638d refusals precede write effects.** Given a caller resolved as an Agent
while its connection claims user, when a write targets a Terminal outside that
Agent's authority, then the existing forbidden result wins even if `data` is
invalid base64, and no write effect occurs. Planned
`r5638d_resolved_agent_cannot_write_as_user` asserts the effective actor, refusal
code and zero input writes through production dispatch. Given an authorized
caller, when params are absent, null, not an object, missing `id`/`data`, have a
wrong field type, or have invalid base64, then dispatch returns `INVALID_PARAMS`
and performs zero input writes; planned `r5638d_malformed_write_has_no_effect`
checks those cases. Preserve unknown-Terminal refusal and its existing ordering
with malformed data in planned `r5638d_unknown_terminal_has_no_effect`.

Policy: preserve Check 4's process-derived authority (the code's H21 guard),
one classification per wire write, and authorization before effects. This does
not reinstate the retired custom question/permission mechanism.

**R5638e dispatch preserves arbitrary ids and notifications.** Given request ids
that are null, booleans, signed/unsigned integers, fractional numbers, arrays,
objects or Unicode/control-bearing strings, when dispatch succeeds or refuses,
then the decoded reply preserves the exact JSON id value. Planned
`r5638e_replies_preserve_arbitrary_ids` checks both outcomes through production
dispatch and line framing. Given a request without an `id`, when it succeeds or
is refused, then it returns no reply; a successful notification still executes
its effect once and a refused notification executes none. Planned
`r5638e_notifications_preserve_effects_without_replies` asserts those results.
Malformed JSON still produces Check 5's parse-error envelope with null id.

**R5638f output scheduling and lifetime stay bounded.** Given in-memory selected
output and pending replies, when output fills its 64-frame queue, then it remains
bounded and a ready reply is written before ready output; planned
`r5638f_reply_precedes_queued_output` asserts actual writer order and backpressure.
Given selected output with a reported gap followed by final bytes, when it ends,
then the forwarded gap range and final tail are delivered in order; planned
`r5638f_gap_and_final_tail_survive_framing` asserts both. Given a replaced or
released selection, or a dropped connection, when forwarding is cancelled, then
its task releases the stream and cannot enqueue further output, while an
unaffected selection continues; planned
`r5638f_selection_cancellation_releases_only_its_stream` asserts each lifetime.
Policy: retain X14's gap recovery, capacity, reply priority and cancellation;
no queue, stream, Bus or client protocol is redesigned.

## Measurement and verification

Policy: build fixtures, parsed requests, encoded strings, expected results,
Daemon stores, runtime and recording sinks before each allocation region; perform
assertions and result decoding after it. Measure allocated bytes, not net live
bytes or RSS, including reallocations. Isolate counting from unrelated tests and
background tasks; use identical prepared fixtures and measurement limits for old
and new paths. Print old/new bytes, fixture sizes, source SHA, toolchain/profile
and command on the implementation Issue. Record how each old reference matches
Checks 1–3. Do not include input parsing in only one side, subtract payload
allocations, or prebuild only the new envelope outside the region.

Run on the prepared checkout in under five minutes:

```sh
cargo nextest run -p rupd --lib -E 'test(output::) | test(connection::) | test(route::)'
```

| Observer result | Exit | Meaning |
| --- | ---: | --- |
| Allocation comparison misses its bound | 100 | Acceptance fails; report old/new allocated bytes |
| Wire fields, decoded bytes or id differ | 100 | Acceptance fails; retain the failed assertion |
| Refusal permits an effect or changes the required error | 100 | Acceptance fails; report calls and error |
| Queue, priority, gap, cancellation or final-tail assertion fails | 100 | Acceptance fails; retain the failed assertion |
| Build or test infrastructure fails | nonzero as returned | Observer incomplete; not an allocation pass |

Policy: existing rule 7 budgets and broader `terminal_write_p95_ms` and
`write_to_output_p95_ms` guards remain unchanged. These observers demonstrate
allocation bytes per chunk/write, not remote transport or render latency. No
App, visual Check or Mac-only observation changes. The applicable P1/P11 gate is
whether dispatch changes who may write to a Terminal or lets a Message write
there; R5638d's effective actor, refusal and effect counts observe the changed
path. No Message delivery path changes. Progress and engineering questions live
on #5638, never in scenario scheduling tables.
