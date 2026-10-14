# Q11 launch observation

Claude Code 2.1.296, Linux, 2026-10-14. Isolated temporary Project and
CLAUDE_CONFIG_DIR; no model request, user plugin installation or startup fetch.
Code revision: `3f0b654a37aaaa76d2ec008d79694eea3f280832`. Observer exit: 0.
The same Launcher and Project supply both role configurations. The real vendor
hook loader probe succeeds before inventory is requested through those argv.

```sh
ROUNDUP_CLAUDE=/home/runner/.local/bin/claude \
  cargo test -p agents --test launch q11_real_claude_loads_three_plugins \
  -- --ignored --nocapture
```

Claude's `plugin list --json` reports, for both Door and child:

| id | version | scope | enabled |
|---|---|---|---|
| hope@inline | 13.1.0 | session | true |
| hunch@inline | 0.9.4 | session | true |
| hold@inline | 0.0.9 | session | true |

Each installPath points to that plugin under the same roundup-owned
`q11-plugins-…` directory. The directories remain readable across initial,
resume and clear configurations. This is the vendor's loaded session inventory,
not a fake argv report. It does not claim model style compliance.

## Rule 7 observation

Two `just perf` invocations, eleven fresh Daemons each, on the same host:
implementation `3f0b654a37aaaa76d2ec008d79694eea3f280832` and unmodified
main `955dfe50`. Both exit 1 on the same five historical-baseline comparisons:
ping, Rail-40, RSS, Terminal write and write-to-output. No budget or allowance
changed. Every implementation metric remains within 10% of same-host main;
Daemon cold start is below 300 ms. This is diagnosis, not R16 calibration.

| Metric | Main | Implementation | Change |
|---|---:|---:|---:|
| `cold_start_ms` | 36.525047 | 36.396818 | -0.35% |
| `hook_loop_ms` | 229.746463 | 230.291981 | +0.24% |
| `ping_p95_ms` | 0.100713 | 0.100981 | +0.27% |
| `rail_tree_10_p95_ms` | 0.179320 | 0.176763 | -1.43% |
| `rail_tree_40_p95_ms` | 0.462746 | 0.455413 | -1.58% |
| `rss_extra_mb` | 2.636719 | 2.601562 | -1.33% |
| `terminal_write_p95_ms` | 0.106291 | 0.101769 | -4.25% |
| `write_to_output_p95_ms` | 0.205759 | 0.203021 | -1.33% |

Loads for the eleven implementation runs: 4.92, 4.92, 4.53, 4.53, 5.61, 5.61, 6.44, 6.44, 5.92, 5.92, 5.45.
Loads for main: 3.53, 3.53, 3.32, 3.32, 3.86, 3.86, 3.55, 3.55, 3.26, 3.26, 3.0. Neither report skips a comparison.

Units: milliseconds except `rss_extra_mb` (MiB). Workload and release build
settings are `just perf`'s unchanged defaults; ten idle login-shell Terminals,
200 hook calls, and the pinned probes. Ubuntu 24.04, x86_64,
`INTEL(R) XEON(R) PLATINUM 8573C`, four CPUs, online/affinity `0-3`,
kernel `6.17.0-1022-azure`, rustc `1.99.0 (b940084d7 2026-09-28)`,
cargo `1.99.0 (5f94df478 2026-08-27)`, `/bin/bash`.

| Release binary | Implementation SHA-256 | Main SHA-256 |
|---|---|---|
| `perf` | `162b60fa093796e9524092537fb5204f62a1b5f957ab768537085d5f083edd0d` | `c9b5115dae6943640c7ddb6ec40701b5f223cf38682772665f8817082024c0df` |
| `rupd` | `88d7378a1d7750aee70a2eb8760b5049b444282d2b6a47d91768c963ff78c358` | `aa43924b40352c7bf936fbb23934e00017a1aec0b575a380fc7c3f25459623e0` |
| `rup` | `23b132492c12ab7403f4124dc95c0f05c14ee9b7b51d6a21528b15c9a849e315` | `23b132492c12ab7403f4124dc95c0f05c14ee9b7b51d6a21528b15c9a849e315` |

Regenerate each report with `just perf` from its revision; the observer writes
`target/perf.json`. The later merge of main `63f64619` changes no native crate,
Cargo dependency or build setting used by these measurements. The runtime
inventory above is rerun explicitly; model style compliance remains policy.
