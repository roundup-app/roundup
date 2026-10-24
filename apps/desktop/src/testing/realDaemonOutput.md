# Selected output in the real-Daemon browser harness

`GET /__daemon/output?terminal=<encoded id>` opens one binary response and one
dedicated Unix socket, on which the relay sends the Daemon's `terminal.output`
request (`{"id": ...}`). The Daemon answers `{"offset": N}` and then pushes
`terminal.output` notifications (`{id, offset, data}` with base64 `data`) and
`terminal.gap` notifications (`{id, from, to}`) for that Terminal alone. The
response starts once the Daemon has answered: a NOT_FOUND answer is HTTP 404
and any other error HTTP 502, each with an `{error: {code, message}}` body.
`Content-Type` is `application/octet-stream`; `X-Terminal` is the
percent-encoded selection and `X-Output-After` is the offset of the first byte
(N). Read `response.body.getReader()` as `Uint8Array` chunks, without a text
decoder. HTTP may split or coalesce chunks; chunk boundaries carry no meaning.
Abort the fetch or cancel its reader to release the selection. Never reuse a
reader for another selection. The socket subscription must answer within 60
seconds; an acknowledged stream has no idle timeout and remains owned by its
browser request.

Each notification's offset must equal the position the bytes so far imply. A
malformed frame, offset gap, a `terminal.gap` notification, invalid base64,
overlarge envelope or incomplete final line fails the response (the body reader
rejects), rather than emitting a clean EOF or concatenating discontinuous
bytes. Discard that selection and reconcile a fresh snapshot before opening
another response; `createServedApp().selectOutput` does this, opening a new
response and giving its listener a gap message from the last delivered
position to the new `X-Output-After`. An orderly socket EOF ends the body
normally.

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

Ordinary RPCs and the global Event route retain their own connections. A kept
output connection cannot queue an ordinary call behind output. This is bounded
dedicated-connection backpressure. An offset discontinuity is fatal to
this response. Cancellation destroys its socket and pipeline, including pending
framing; late data has no path to a replacement response.

## What this proves

The `x14_harness_output_relay_*` observers use fixture-owned Unix sockets and
actual HTTP; byte fidelity also crosses an isolated headless agent-browser
profile. The saturation observer pauses the HTTP receiver directly to make the
network backpressure barrier deterministic, checks the actual Node writable
queue and observes a control reply while the output sender is kept. These prove
harness transport support only. They claim no X14 production isolation, raw
Tauri body, parser, matched performance or full flood journey acceptance.
