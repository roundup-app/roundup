# Release code generation (#3696)

The M4 Max run at `9de5a4b72` retains about 5 ms of store initialization
inside a 10.535 ms cold start, with a 0.15 ms runtime. The remaining interval
includes executable loading, polling and the first ping; it is not pure spawn
time. The binary-size hypothesis above remains unproven on that Mac.

Cargo's default release profile optimizes within code-generation units but does
not enable cross-crate LTO. The release profile uses built-in thin LTO and one
code-generation unit to reduce this measured overhead, with extra release
compilation/link work as the tradeoff. Development/test profiles are unchanged.
See [Cargo profiles](https://doc.rust-lang.org/cargo/reference/profiles.html#lto).
No parser, cache, collector, dependency or custom build machinery is added.

Same-source Linux A/B: Rust code at `936b9c726`, lockfile SHA256
`c42bc3e5fb49c850d717477926bcb695e7929115e3ec9dd2350a8dca50c906a1`,
AMD EPYC 9V45, four CPUs, rustc 1.99.0. Build `rupd` and `rup` with default
release settings, thin LTO alone, then thin LTO plus `codegen-units=1`, saving
each binary. The experimental overrides are
`cargo --config 'profile.release.lto="thin"' --config 'profile.release.codegen-units=1' build --release -p rupd -p rup`;
the retained manifest produces the last variant without overrides.

Stop builds/tests. Run nine comparisons, rotating default/thin/single-unit
order each time. Each invocation starts eleven fresh isolated Projects. Time
process creation through the first successful `daemon.ping`, polling socket
connection every 100 microseconds with a ten-second deadline. Then create
forty Workstreams; time 550 sequential `rail.tree` socket round trips, discard
the first 50, and calculate median/p95 for the remaining 500. A buffered Python
JSON client includes its serialization/parsing cost and checks all forty names.
Kill/reap each run-owned Daemon before removing its temporary data. No shells
or vendor programs are started. This is a diagnostic workload, not `just perf`.

Medians of the nine invocation medians (Rail p95: median of eleven per-Daemon
p95s, then median of invocations):

| Measurement | Default | Thin only | Thin + one unit |
|---|---:|---:|---:|
| Executable bytes | 33,318,896 | 33,246,616 | 25,437,736 |
| GNU `size` text/data/BSS total bytes | 25,624,810 | 25,887,810 | 21,834,154 |
| First ping, ms | 8.837 | 8.393 | 8.391 |
| Rail reply median, microseconds | 175.986 | 177.298 | 173.782 |
| Rail reply p95, microseconds | 276.136 | 270.689 | 265.090 |

The retained pair saves 23.7% of executable file bytes, 0.446 ms of local
startup and 11.046 microseconds of local reply p95. Thin alone does not shrink
the executable sections; the single-unit variant does. Every retained-variant
invocation's Rail p95 is below its default counterpart. Startup's `open` median
falls from 6.81 to 6.66 ms; runtime medians are 0.248 and 0.238 ms. The rest of
the startup difference is an external residual, not attribution of loader time.
One-minute load ranges from 2.208 to 2.601 (0.55–0.65 per CPU). Raw per-Daemon
results, binary hashes and probe source are retained on #3696.

Both required lints and all 1,166 executed Agents/Daemon/RPC/Terminal tests pass
(seven existing skips). The release probe also checks real optimized replies.
No configuration-text test is added (rule 10); no existing test is changed or
removed. These measurements establish a compiler-setting contribution on Linux,
not the Mac's complete startup cost, idle RSS attribution or an R3696c pass.
Budgets remain unchanged. Full same-M4-Max acceptance, complete feature-cost
attribution, unchanged-code false-fail evidence and the separate later main
pass remain open; no baseline rebase or repeated Mac request is made.
