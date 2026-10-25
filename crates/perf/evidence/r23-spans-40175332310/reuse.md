# Observer reuse

The pinned Cargo manifests already supply serde_json Value extraction and typed
output deserialization, Tokio broadcast/oneshot delivery, and std::time::Instant.
The scratch patch brackets those existing operations; it adds no clock abstraction,
protocol parser, store or runtime dependency. Python's installed json, csv, re,
subprocess and gzip modules retain commands and extract the diagnostic text.

Two maintained Rust instrumentation libraries were considered before instrumentation:

- [tracing 0.1.44](https://docs.rs/tracing/0.1.44/tracing/),
  [release history](https://github.com/tokio-rs/tracing/releases): application spans
  require call sites and a subscriber. It cannot observe the unmodified pinned
  Daemons' internal queue acceptance; adding it would also replace the probe's
  existing stderr/Instant mechanism and change its dependency graph.
- [tracy-client 0.19.0](https://docs.rs/tracy-client/0.19.0/tracy_client/): the current
  published documentation and version establish maintained bindings. Its spans
  require an initialized Tracy client and instrumentation sites; it cannot obtain
  the missing unmodified-binary queue markers either. Its extra runtime and client
  transport are unnecessary for recording timestamps around existing probe code.

Selected: the existing standard-library clock/stderr and installed serde_json/Tokio
operations, with both changed and unchanged probe binaries controlled against each
identical Daemon. No replacement instrumentation framework is implemented.

For kernel/process observation, selected installed perf 6.17.13 and strace 6.8.
[perf sched documentation](https://github.com/torvalds/linux/blob/master/tools/perf/Documentation/perf-sched.txt)
describes the scheduling events; [strace releases](https://gitlab.com/strace/strace/-/releases)
show continuing maintenance (6.17, 2025-09-29). strace supplies FD-resolved payloads;
perf supplies switch/waking/wakeup records on CLOCK_MONOTONIC. Neither alone
supplies both. Installed bpftrace 0.20.2 was inspected but not used: syscall probes
would duplicate perf's kernel observer and still lack typed application queue
identities without additional userspace instrumentation. Raw traces retain that
boundary rather than claiming to resolve it.
