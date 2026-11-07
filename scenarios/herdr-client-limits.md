# herdr client limits

Module: `crates/herdr`. Work order: #6743; found by the review of PR #6735. Decision: `docs/adr/0012-herdr-core-machine-layer.md`. Both scenarios need an injected failure (a hostile or corrupt stream, a pipe closing mid-call), so each test drives the client over an in-memory duplex stream and no real herdr-core.

## Checks on main

1. `crates/herdr/src/lib.rs`, functions `read_frame` and `Client::call`: the frame reader and the request path these scenarios change.
2. `crates/herdr/src/lib.rs`, enum `Error`: `Protocol` (code `core_protocol`), `Closed` (`core_closed`) and `TimedOut` (`core_silent`).

**MC47 a frame length is capped.** Given a core stream whose frame header declares a payload longer than the cap (16 MiB), when the client reads it, then it fails with `Error::Protocol` naming the length and the cap, before it allocates or reads any payload; every waiting `call` then fails with `Error::Closed`, as for any dead reader. A frame of exactly the cap is read whole. Tests: `mc47_an_oversized_frame_is_a_protocol_error` (a header declaring `u32::MAX`, no payload bytes behind it: `Error::Protocol`, returned at once with no allocation of that size); `mc47_a_frame_at_the_cap_is_read` (a payload of exactly 16 MiB comes back byte for byte).

**MC48 a call on a closed pipe is Closed, never TimedOut.** Given a client whose reader task has seen the pipe close and cleared `pending`, when `call` runs, then it returns `Error::Closed` at once, not after the timeout and never `Error::TimedOut`, whichever of the two (registering the `pending` entry, the reader clearing it) happens first. Tests: `mc48_a_call_after_the_pipe_closed_is_closed_not_timed_out` (close the far end, wait for the reader to end, call with a 5 s timeout: `Error::Closed` in under 1 s); `mc48_a_call_registered_after_the_clear_is_closed` (a call whose entry is inserted after the reader's clear, forced by a hook between the insert and the send: `Error::Closed`).
