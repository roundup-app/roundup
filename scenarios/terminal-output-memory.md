# Bounded Terminal output storage

Module: `crates/terminal`. Work order: #5639. This specifies the internal
output change only; X13 (`scenarios/terminal.md`) and X14/X16
(`scenarios/terminal-stream.md`) keep their contracts. The `x5639` test names
below are required implementation acceptance, not tests delivered by this spec.

**X5639a retain the output suffix without temporary overflow.** Given an empty
Output log with the existing power-of-two limit `LOG_BYTES = 1_048_576`, when
bytes arrive through `Log::push`, then:

1. **Lazy storage.** Construction and an empty push allocate no ring storage or
   checkpoint. A first 8192-byte push allocates less than `LOG_BYTES` and creates
   no checkpoint. Subsequent growth follows retained output rather than eagerly
   reserving the full limit. Test:
   `x5639a_ring_storage_grows_only_when_output_arrives` in the unit tests of
   `crates/terminal/src/output.rs`.
2. **Bounded ring.** Feed 129 distinct 8192-byte chunks, then continue through at
   least three full ring lengths of output. After every push, the ring's capacity
   is at most `LOG_BYTES`, its contents are exactly the last
   `min(total_bytes, LOG_BYTES)` input bytes, `end` equals the total input byte
   count, and `start = end - retained_length`. In particular the 129th push
   retains 1 MiB with start 8192 and end 1_056_768 without a 2 MiB capacity.
   Test: `x5639a_repeated_wraps_keep_the_exact_suffix_within_capacity` in the
   unit tests of `crates/terminal/src/output.rs`.
3. **Oversized chunks.** Push a chunk larger than the limit into both an empty
   log and a log whose deque has wrapped. Include a chunk larger than twice the
   limit. After each push the same capacity, exact suffix and absolute-offset
   assertions in clause 2 hold. Test:
   `x5639a_oversized_chunks_keep_only_the_bounded_suffix` in the unit tests of
   `crates/terminal/src/output.rs`.

Policy: feed the evicted existing bytes into the existing checkpoint in byte
order, remove those bytes, then append only the incoming suffix that fits. If
incoming bytes alone exceed the limit, absorb their discarded prefix after the
old bytes, before retaining their suffix. Every discarded byte advances the
checkpoint exactly once at its original absolute offset. The ring never holds
more than the limit, including during a push. Preserve both ring history and
checkpoint; neither may be removed as a cache. Capacity assertions concern the
ring allocation, not the checkpoint parser or a read's reply buffers.

**X5639b eviction preserves exact replay.** Given output containing CSI
cursor movement/erase and colour, OSC, carriage-return redraws, CRLF, UTF-8 and
invalid bytes, when output repeatedly wraps and oversized chunks discard both
old ring bytes and an incoming prefix, then replay has the same parser state,
plain text and absolute offsets as processing those bytes in order without the
temporary-overflow operation.

Test: `x5639b_eviction_preserves_exact_replay` in the unit tests of
`crates/terminal/src/output.rs`. Use deterministic fixtures with explicit expected
text and offsets, including cuts inside CSI, OSC and a multibyte character at
both an old-ring boundary and an oversized incoming-prefix boundary. Exercise a
deque whose `as_slices` has two nonempty slices before eviction. Compare the
retained replay's final parser screen/state with an uninterrupted `vt100`
reference; complete a sequence after eviction to expose lost partial parser
state. Assert exact `read` text, `from`, `next`, `truncated`, and `search` match
text/offsets and continuation against the fixture. Page from `next` until the
end, with no missing or repeated retained text. An older cursor clamps to
`start`; a cursor at `end` is empty; a future cursor is refused. Keep the existing
X14 split-sequence eviction test (Check 2) unless a test proving all its cuts
replaces it under rule 10.

Policy: keep X13/X16 read caps, wrapped snapshots, read-only behaviour and
checkpoint semantics. Use the existing `vt100` parser, not a second escape or
UTF-8 parser. No input ownership, Agents write path, RPC, contract or App change
belongs to this work.

**X5639c remote output moves the decoded payload once.** Given a decoded remote
output chunk with a nonzero absolute offset and bytes including NUL, ESC,
invalid UTF-8 and a split multibyte character, when the production remote
byte-processing path publishes the chunk, then its bytes and offset are exact
and the tracked end is `offset + decoded_length`. Capture that length before
moving the decoded `Vec<u8>` into `Arc<[u8]>`; do not clone or otherwise copy the
Vec first. A Vec-to-Arc conversion may still allocate and copy once.

Test: `x5639c_remote_output_preserves_bytes_offsets_and_tail` in colocated unit
tests in `crates/terminal/src/remote.rs`, exercising the production byte-handling
boundary without connecting an owner or starting a PTY. Include consecutive
chunks, an authoritative offset jump after lag, and final catch-up bytes followed
by stream closure. The consumer sees the existing gap and the exact final tail
before the stream ends; bookkeeping never invents continuity or repeats bytes.
A private extraction of the existing byte handler is allowed; a test-only copy
of that handler proves nothing.

Test: `x5639c_remote_output_avoids_the_temporary_payload_allocation` in the same
unit-test module. With the input and receiver prepared outside the measured
region, compare the production decoded-byte-to-published-chunk operation with
the same operation using the former `Arc::from(bytes.clone())` path. The latter
allocates exactly one additional payload-sized buffer; both publish identical
bytes and update the end identically. Isolate allocation counting from concurrent
work and keep fixture/receiver allocations outside the comparison. The installed
`stats_alloc` dev dependency is available (Check 4). This does not claim that
Vec-to-Arc is zero-copy or that total remote output allocation is zero.

## Checks on main

1. `crates/terminal/src/output.rs`, `Log::push`, `Log::raw`, `Log::from`,
   `Replay::absorb` and `Window::each_line`: existing suffix, absolute-offset and
   checkpoint/replay boundaries.
2. `crates/terminal/src/output.rs`,
   `x14_a_prefix_evicted_inside_an_escape_or_character_is_replayed_by_the_parser`:
   existing CSI, OSC and UTF-8 eviction cuts and search-offset assertions.
3. `crates/terminal/src/remote.rs`, `Remote::connect`: decoded bytes are published
   as a `Chunk`, lag retains the next authoritative offset, and exit catches up
   the final tail before closing the sender. `crates/terminal/src/lib.rs`,
   `OutputStream::next`: offset jumps become gaps before the pending bytes.
4. `crates/terminal/Cargo.toml`, `[dev-dependencies]`, and
   `crates/terminal/tests/perf.rs`,
   `r3696c_ten_idle_terminal_grids_retain_under_850_kb`: existing allocation
   instrumentation. This spec requires no new allocator library or runtime cache.

## Observer and scope

Implementation changes only `crates/terminal/src/output.rs`,
`crates/terminal/src/remote.rs` and their colocated unit tests; target 150–300
changed lines. No PTY, owner, Daemon, browser or vendor program starts for these
tests. The prepared-checkout acceptance command completes in under five minutes:

```sh
cargo nextest run -p terminal --lib -E 'test(output::) | test(remote::)'
```

Policy: required lints and CI gates still apply. Record actual command exits and
measurements on the Work Issue. A failing assertion or nonzero command exit leaves
acceptance unmet; a missing test, unavailable allocator observation or a run at
or above five minutes leaves the observer incomplete. No script is added here.

Rule 7 observer: the 129-chunk ring-capacity comparison establishes 1 MiB less
ring allocation than the reported 2 MiB baseline, at identical bytes and offsets.
It does not measure whole-process RSS or establish the 150 MB budget for ten
Agents. The shell-only `rss_extra_mb` workload does not fill the rings and cannot
prove this saving. Keep existing performance budgets and regressions unchanged.
