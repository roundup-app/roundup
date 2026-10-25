# U3523f shipped-sidecar performance (#3681)

On 2026-10-25, Builder 40242009209 ran `just perf` on
`3c606bea3df495946b21b9521bd95dd7c751b74b`: exit 0, `passed: true`,
`clean: true`, no skipped comparisons and no stored misses.

```text
release build → sidecar beside rupd → qualified same-job pair → all nine metrics pass
```

R16 selected its supported uncalibrated `linux-9v45` paired path on Ubuntu
24.04, AMD EPYC 9V45 96-Core Processor, four online/available CPUs, affinity
0-3. Both immutable references are this same main commit: this records a
current packaged-build observation, not an A/B of a source change. Both
independently built Daemons, CLIs and bundled Node binaries have equal hashes.
No baseline, budget, noise allowance or load threshold changed; #3706's
cancelled calibration is not required by this implemented paired path.

Each side has eleven fresh-Daemon samples, 1,000 calls per latency sample.
Loads ranged 2.40–3.74 on four CPUs, below R13's
2.0-per-CPU threshold. The report retains raw samples, loads, host/job/boot
identity, source and binary hashes, observer/toolchain/settings, commands,
invocation order, ceilings, limits and exit. `perf.*.startup-*.log` retain
all 22 Daemon startup logs; `perf.log` retains build and measurement output.

| Metric (ms, except RSS in MiB) | Base | Head | Paired ceiling |
|---|---:|---:|---:|
| cold_plugin_materialization_ms | 9.152320 | 9.097936 | 10.068552 |
| cold_start_ms | 9.565561 | 9.709758 | 10.822117 |
| hook_loop_ms | 206.996426 | 208.709588 | 227.696069 |
| ping_p95_ms | 0.036735 | 0.035854 | 0.041409 |
| rail_tree_10_p95_ms | 0.099299 | 0.100161 | 0.109229 |
| rail_tree_40_p95_ms | 0.241984 | 0.250522 | 0.267182 |
| rss_extra_mb | 2.347656 | 2.394531 | 2.632422 |
| terminal_write_p95_ms | 0.055449 | 0.054602 | 0.061994 |
| write_to_output_p95_ms | 0.109144 | 0.108363 | 0.121058 |

Cold start 9.710 ms is below 300 ms; ten-idle-Agent extra RSS 2.395 MiB is
below 150 MiB; terminal write-to-output p95 0.108 ms is below 16 ms.
The latter is the Daemon observer, not a native App keystroke measurement.

## Shipped runtime and listing behavior

Packaging was implemented by `f4b2e8453924cfa9f69d27d2801256a45170f61c`.
Both `app-release` and `perf` invoke `tools/sidecar/bundle.sh` after building
`rupd`. This run assembled `target/release/sidecar` with checksum-pinned
Node 22.23.3, `list.mjs`, SDK 0.3.309 `node_modules`, `package.json`,
`NOTICES.md` and `NODE-LICENSE`: 129,818,645 apparent bytes (`du -sb`).
Each paired build also assembled and hashed its shipped runtime.

`u3523f_runtime_is_lazy_bounded_and_reaped` passed in 1.217 seconds on this
checkout (`test.log`). Through the real Daemon seam and isolated packaging
fixture it asserts that opening a Project starts no listing child, listing
returns the eligible candidate, completion/cancellation reap children, and
missing runtime/CLI returns its cause and recovery rather than an empty list.
Together with the existing sidecar A/B recorded on #3681, this supplies the
missing qualified observation; the current pair alone does not isolate the
sidecar's incremental cost. The user reports what they meet on the Mac.

## Reproduce

```sh
git checkout 3c606bea3df495946b21b9521bd95dd7c751b74b
pnpm install --frozen-lockfile
just perf
cargo nextest run -p rupd -E 'test(u3523f_runtime_is_lazy_bounded_and_reaped)'
```

Use a supported Builder with `origin/main` available. The recorded command
resolved merge-base and head to the commit above; a later main may produce
a different pair. Exit 0 with `clean: true` and no skips qualifies the run;
exit 1 requires investigating misses; exit 2 means the observation is incomplete.
`just lint-web` and `just lint-rust` also exited 0 on this checkout.
