# Selected output in the real-Daemon browser harness

`GET /__daemon/output?terminal=<encoded id>&after=<byte offset>` opens one
binary response and one dedicated Unix socket. `Content-Type` is
`application/octet-stream`; `X-Terminal` is the percent-encoded selection and
`X-Output-After` is its initial byte offset. Read `response.body.getReader()`
as `Uint8Array` chunks, without a text decoder. HTTP may split or coalesce
chunks; chunk boundaries carry no meaning. Abort the fetch or cancel its reader
to release the selection. Never reuse a reader for another selection. The socket
subscription must answer within 60 seconds; an acknowledged stream has no idle
timeout and remains owned by its browser request.

The starting offset must equal the next selected Event's offset. A malformed
frame, offset gap, invalid base64, overlarge envelope or incomplete final line
fails the response (the body reader rejects), rather than emitting a clean EOF
or concatenating discontinuous bytes. Discard that selection and reconcile a
fresh snapshot before opening another response. No automatic replay or recovery
is implemented here. An orderly socket EOF ends the body normally.

## Retention and control

Node's `stream.pipeline` and the socket async iterator propagate HTTP
backpressure onto this request's dedicated socket. There is no application
output queue. The adapter accepts socket reads up to 64 KiB and Event lines up
to 256 KiB, failing the selection if either bound is exceeded. Pending framing
holds at most 320 KiB, including the read being processed; decoded output from
one line is at most 192 KiB. Each pipeline yield waits on downstream demand.
The HTTP writable queue holds at most its `writableHighWaterMark` plus one
192 KiB payload; the socket readable queue holds its `readableHighWaterMark`
plus one 64 KiB read. Buffer slices can retain the current 320 KiB backing
allocation; JSON/base64 parsing adds a bounded per-line allocation. Kernel and
browser transport buffers are separate, finite transport buffers. There is no
accumulation proportional to the duration of a pause. Bounds are per selection;
callers own and must release their displayed selections.

Ordinary RPCs and the global Event route retain their own connections. A held
output connection cannot queue an ordinary call behind output. This is bounded
dedicated-connection backpressure, not production PTY isolation: today's global
Event subscription can still lag upstream. An offset discontinuity is fatal to
this response. Cancellation destroys its socket and pipeline, including pending
framing; late data has no path to a replacement response.

## Integration owned by #1930

This prerequisite enables no new Terminal RPC and changes no App seam. Its
socket adapter temporarily selects `terminal.output` from today's
`events.subscribe` envelopes solely to exercise the transport. In #1930 replace
that subscription request and envelope decoding with the selected production
subscription, carrying its offset/recovery facts in control metadata. Do not
retain `events.subscribe` as an output fallback. Update `createServedApp` with
its other production callers: open one binary response per displayed Terminal,
install its reader before attach/snapshot reconciliation, reconcile offsets,
and abort on disposal, replacement or Project disconnect. The global Event
reader remains for control events only once the Daemon removes global output.

The `x14_harness_output_relay_*` observers use fixture-owned Unix sockets and
actual HTTP; byte fidelity also crosses an isolated headless agent-browser
profile. The saturation observer pauses the HTTP receiver directly to make the
network backpressure barrier deterministic, checks the actual Node writable
queue and observes a control reply while the output sender is held. These prove
harness transport support only. They claim no X14 production isolation, raw
Tauri body, parser, matched performance or full flood journey acceptance.
