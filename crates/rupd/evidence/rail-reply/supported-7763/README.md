# R16 supported 7763 comparison

Refs #1369. Daemon repair merged in #1373; this run supplies the outstanding supported-class observations, retaining every result without changing thresholds or workload.

```text
historical compatible probe (one frozen binary)
  → historical / current Daemon, alternating nine pairs
  → preserve all reports, loads, exits and ceiling misses
```

The probe has only the already retained compatibility patch from `crates/rpc/r16/probe-compatible.patch`; its embedded historical Client is unchanged. Build commands use each reference's committed lockfile and default release profile with the same toolchain. Actual hashes are retained; a rebuild is not represented as the earlier probe hash. Acceptance is evaluated after observations.
