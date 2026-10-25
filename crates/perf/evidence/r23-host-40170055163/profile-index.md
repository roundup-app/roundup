# R23 separate diagnostic profiles

Both reference profiles ran after all six timing invocations on the same
qualified lifetime. `binaries.sha256` identifies the unmodified Daemons and common
probe. No diagnostic profile or control counts as a timing pair.

CPU profiler: perf 6.17.13, software cpu-clock, 199 Hz, DWARF call stacks with
16384-byte dumps, inherited into Daemons and their children. Historical: 4478
samples, candidate: 5642; both recordings report zero lost samples. Both profile
observers exit 1 against the diagnostic ceilings, retaining their reports (`*-profile.json.gz`).
`*-profile.command` records exact argv; corresponding stdout/stderr and JSON
retain every miss. `*-perf.data.gz` retains each complete raw recording;
`*-cpu-report.stdout.gz` retains the complete resolved call-stack report, and
`*-cpu-flat.stdout.gz` its flat view (trailing whitespace trimmed). `*-buildids.stdout` retains DSO identities.
These include probe, Daemon, shell and kernel work, not only the write path;
use DSO/comm and stacks to distinguish them. No Daemon instrumentation was used.

Separate unprofiled controls use the same 50000 calls and one fresh Daemon as
CPU profiling. Control and syscall JSON reports are also gzip-compressed after collection.
These wall times include setup/cleanup and profiler start/stop;
relative overhead is diagnostic, not a correction to the clean timing pairs.

| Reference | Control wall seconds | Profile wall seconds | Difference |
|---|---|---|---|
| historical | 24.312 | 26.366 | +8.4% |
| candidate | 29.468 | 32.271 | +9.5% |

The further separate `*-syscalls.command` uses strace 6.8 with `-f -c -w` and
1000 calls, retaining summary, observer JSON, stdout/stderr, status and elapsed
wall time. Its `*-strace-summary.txt` seconds sum overlapping per-thread syscall
wall times; read/epoll/futex waits are not CPU samples or additive end-to-end
latency. Tracing overhead makes these unsuitable for latency conclusions.

CPU sampling and syscall summaries retain CPU work and waiting diagnostics for
#3760's attribution review. They do not by themselves prove a dominant scheduling
boundary or a repair; unresolved attribution and further probes remain #3760's
work under #3720. This PR supplies the lifetime and observations only.

Inspect full text with `gzip -dc historical-cpu-report.stdout.gz`; inspect raw
recordings with the decompression/perf commands in `reproduce.txt`. Original
DSO binaries are not committed; resolved text retains symbol names even after
the ephemeral build paths disappear. Rebuilding a DSO must match its retained
hash/build id before using it to symbolize the raw recording.
