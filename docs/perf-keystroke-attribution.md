# R20 hop attribution

Recorder mechanics and window-free proofs for R20. The [retained native observations](perf.md#r20-observations-retained-from-3550) include failed recorder attempts and the [first valid full-chain idle baseline](perf.md#valid-full-chain-idle-baseline-2026-10-25).

The opt-in report carries every hop's p50/p95 and sample count. Webview marks
use `performance.now()`; receipt (before decoding), physical `write_all` plus
`flush` completion and raw PTY read use one Daemon monotonic clock.
`terminal.measure` enables a bounded recording on the ready Terminal and returns
that clock with its samples. Normal Terminals hold no recording; normal writes
still acknowledge enqueue, with unchanged ordering and reply serialization.

The raw `cat` workload echoes an invisible OSC 777 marker with a run nonce and
key ordinal, followed by `a`. The character ends the framed identity, so even a
split output chunk cannot render it before its identity can be attributed. The probe adds this marker at xterm's `onData`, before
the production queue and base64 conversion; it never changes ordinary builds or
vendor input. This adds marker-byte overhead to the measured workload, so these
reports must not be treated as equivalent to the retained unmarked native runs.
The same marker is matched across split PTY/output chunks. Other output and other
Terminals cannot finish a sample; abandoned identities remain distinct from the
next key. Missing or duplicate evidence cannot supply a valid full chain.
Snapshots do not stamp output arrival.

Before and after typing, a webview exchange brackets a `terminal.measure` clock
reading. For each exchange the offset lies in
`[daemon - received - resolution, daemon - sent + resolution]`.
`calibration` retains every exchange, their intersected midpoint `offset_ms`,
half-width `uncertainty_ms`, and the independently observed `resolution_ms`.
Disagreeing bounds invalidate the observation. This assumes a stable clock offset
over the bounded run; endpoint exchanges detect drift beyond their bounds.
`timer_resolution_ms` still records WKWebView's existing 1 ms resolution;
`hop_uncertainty_ms` is the calibration half-width, including transport ambiguity
and quantization, rather than resolution alone. Cross-clock hop estimates may
be slightly negative within that retained uncertainty; same-clock durations
must be nonnegative. No one-way transport precision smaller than these bounds
is claimed. Per key:


| Hop | From → to |
| --- | --- |
| `keydown_to_input` | `keydown` → xterm `onData` |
| `input_to_dispatch` | `onData` → `terminal.write` called; retained coarse span for the earlier reports |
| `input_to_encoded` | `onData` → base64 encoding completed; retained coarse queue-plus-encoding span |
| `input_to_encoding` | `onData` → the queue releases this batch for encoding; includes waiting for the previous write reply |
| `encoding_to_encoded` | byte preparation and base64 encoding, after the queue releases the batch |
| `encoded_to_dispatch` | base64 encoding completed → `terminal.write` called |
| `dispatch_to_echo_event` | dispatch → live output event arrival; retained coarse round trip |
| `dispatch_to_daemon` | dispatch → Daemon receipt, using calibrated offset |
| `daemon_to_write` | receipt → physical PTY write and flush completed, including the Daemon input queue |
| `write_to_echo_read` | physical completion → PTY read carrying the echo identity |
| `echo_read_to_event` | PTY read → live webview output arrival, using calibrated offset |
| `echo_event_to_parsed` | live output event arrival → xterm has parsed the echo identity |
| `parsed_to_frame` | parsed → the next render |
| `write_reply` | `terminal.write` called → its reply (overlaps the echo's trip) |

Screens stamps encoding start before byte preparation, then completion after `toBase64` and before RPC dispatch, through the existing optional emulator probe.
`input_to_encoding` measures queue wait; `encoding_to_encoded` measures byte preparation
and base64. Both are required (exit 2 if absent); coarse spans remain for comparison.
The valid idle baseline includes these marks. No production latency repair is claimed.

The no-window `r20_encoding_is_stamped_only_when_the_queued_bytes_are_ready_to_dispatch`
failed before the start mark: with a held RPC reply, queued batches preserve the order
start → actual base64 conversion → complete → dispatch. `r20_hop_report_accounts_for_the_echo_round_trip`
crosses the production desktop observation wiring, actual xterm input/parse,
Screens queue and traced RPC with a deterministic clock, delayed reply, unrelated
output, split and late echoes, and a render before echo. Its Rust namesake crosses
the write handler, queue, physical writer, PTY pump and serialized collection with
controlled IO and no program or window. The old probe-only example was replaced
by this stronger wiring proof. Encoding ordering remains covered by the existing
queue test above.

The collector also requires every required hop's sample count to equal the
rendered sample count, with finite, ordered p50/p95 values and the clock bounds above. Rendered
samples plus drops must account for the requested measured keys; drops can also
include warm-up keys. Incomplete or invalid attribution exits 2 and names the
run and hop/count. A valid distribution with dropped keys still exits 1. The
no-window `r20_invalid_hop_distributions_cannot_authorize_a_latency_verdict` and
`r20_missing_measured_keys_cannot_be_silently_skipped` regressions both failed
before the validation repair. This changes report validation, not the input path
or any retained native timing.

The collector independently recomputes calibration bounds and rejects missing exchanges, invalid clocks, forged uncertainty and incomplete hop counts with exit 2.
The valid quiet-Mac baseline places `parsed_to_frame` first among the full-chain
spans (p50 4 ms; p95 7/8/8 ms). It establishes idle attribution; a production
latency repair and attribution under another Terminal's flood remain unclaimed.

The recorder accepts input, write replies, echo bytes and renders only from the
Terminal that printed the ready line. Previously every emulator shared those
marks: another Terminal printing `a` could supply the echo, and another
Terminal's render could complete a sample after the measured echo was parsed.
The deterministic `r20_another_terminal_cannot_supply_the_echo_or_finish_its_render`
and `r20_another_terminals_write_cannot_stamp_the_measured_input` tests reproduce
both forms of contamination without a native window. The retained Mac reports
predate this correction; this identifies a possible attribution error, not
evidence that another Terminal actually contaminated those runs. No reports are
discarded and no production latency improvement is claimed.

