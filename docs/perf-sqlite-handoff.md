# SQLite startup connection handoff (R3696c)

The migration connection closed before the Event log opened `project.db` again.
That removed the last WAL/SHM handles, unlinked both files, and required another
open and schema load. `storage::open` returns its migrated `Connection` to the
Event log, which retains its existing `synchronous=NORMAL` and busy timeout.

```text
migration → same Connection → Event log
```

The isolated repair is `8055150e7a8efed21f3a3d9cbf35aed903d0ad5b`, compared with
`03c3f4150487207df9410381c2eea4e050faf6c4`, before newer main was merged.
Both references used `cargo build --release -p rupd -p rup -p perf` (exit 0).
[Exact probe, driver, hashes and all 180 numeric startup records](https://github.com/roundup-app/roundup/issues/3696#issuecomment-6395521676)
retain the same-host/session diagnosis, including every phase and load.

Host class: `linux-7763`, AMD EPYC 7763, four affinity CPUs, Linux 6.17.0-1022-azure,
glibc 2.39. Physical VM identity: SHA256 of `/sys/class/dmi/id/product_uuid` is
`094d1630a9744a1ffb2b1904927960423aea6c3856d829598d34fe7e68c9e8d2`.
Session: `builder-40174946219-2026-10-25`; load 2.443–2.569, 0.611–0.642/CPU.
Tokio workers were fixed at four on both sides. Builds/tests stopped before timing.

Each reference gets five warm-up starts, then nine rotating pairs of ten fresh
Projects per side. Odd pairs run before/after, even pairs after/before.
The exact commands, with the probe retained at the evidence link, are:

```sh
python3 /tmp/probe-3696.py /tmp/3696-before-rupd 10
python3 /tmp/probe-3696.py /tmp/roundup-3696/target/release/rupd 10
```

The parent polls socket readiness every 0.1 ms and ends timing on a matching
`daemon.ping` response. Each start has isolated temporary Project/data/socket
paths and reaps its process group. All eighteen measured invocations exit 0;
no sample failed or was skipped. Values below are medians of invocation medians.

| Linux diagnostic, ms | Before | After |
|---|---:|---:|
| First-ping wall time | 14.540712 | 13.231736 |
| Daemon open | 11.445000 | 10.465000 |
| Storage phase | 3.186299 | 2.952547 |
| Base-store phase | 2.220120 | 1.495007 |

Every pair improves first-ping and base-store medians. A separate `strace -f`
recording before the `startup: stores` diagnostic shows database opens 13 → 12,
SHM opens 2 → 1 and early WAL unlinks 1 → 0. Trace times do not enter the table.

`event_log::tests::r3696c_migration_keeps_the_wal_open_for_the_event_log` observes
WAL lifetime without a process or clock. It failed before the repair and passes
afterward. The existing schema-equivalence and Event-log replay/sequence tests
prove different behavior and remain.

These are Linux diagnostic figures. The required same-M4-Max `just perf` pass,
remaining startup/Rail attribution, unchanged-code false-fail evidence and the
separate later main pass remain open on #3696. Budgets and baselines are unchanged;
this repair justifies no baseline rebase.
