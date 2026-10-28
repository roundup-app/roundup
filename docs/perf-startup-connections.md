# Four idle Project connections (R3696c, #4052)

The supplied M4 Max session already establishes the regression: baseline
`02fd86775695e4f0e6eb29d5be916ce5ebf94c1e` passed 9/9 invocations; main `235ba2d91d89ad7b449dea2a950cd37d0fa185c5` failed all eight load-qualified
ones. Cold-start medians were 5.945 / 10.527 ms against 8.110 ms. The ninth main
invocation skipped comparisons. Its startup logs locate 4.93 ms in store opening,
including 1.49 ms in storage; native phase observations locate about 4.0 ms of the
delta before socket bind. Those observations do not identify a specific SQL call.
[Paired results](https://github.com/roundup-app/roundup/issues/3696#issuecomment-6399785121),
[startup logs](https://github.com/roundup-app/roundup/issues/3696#issuecomment-6399785450)
and [native phases](https://github.com/roundup-app/roundup/issues/3696#issuecomment-6399785717)
remain the Mac evidence; this repair requests no repeat of that session.

## Operation and repair

`storage::open` establishes WAL and migrates `project.db` before opening the
stores. Touches, Todos, Pads and Checkpoints have no startup recovery query, yet
each repeats `PRAGMA journal_mode=WAL`. SQLite loads the full Project schema for
each of those independent connections. Their following `schema::open` already
returns immediately for `project.db`.

```diff
 Project startup
   materialize image, initialize WAL and migrate
-  repeat WAL setup in four idle stores
+  open their independent connections
   run every startup recovery
```

Only those four Project pragmas are omitted. SQLite reads their schema on first
use. This saves startup work, not total work for an operation that later uses all
four stores. Standalone paths still establish WAL and migrate. Foreign keys,
transaction modes, busy handlers, failure propagation, identity patching, fsync,
linking and every recovery query retain their existing code. The Daemon still
validates the Project database in `storage::open` before opening these handles.
No connection, lock or cache is shared; no state or background task is added.

The caller change that introduced full-Project schema loading is consolidation
commit `8961dc938fab29ec8c8ddb578a470843d6ba54d0`: it redirected these four stores
from their standalone databases to `project.db`, retaining their standalone WAL
pragmas. `dfc349fa2ea383e7a5013ef1a466f29ed23211be` made the Project schema
functions no-ops but retained those pragmas. The isolated repair is
`0666f2d3a0a5b9012de4c9b8aa236390f6b544de`, compared with reference
`7fbf5d6ff7bbc2702f152112caad01caca45daa0` (which already includes #4079's
image-copy repair). This A/B attributes only the four removed eager reads;
it does not assign the remaining startup difference to a feature or binary size.

Installed capabilities were checked first: [rusqlite 0.40.2](https://docs.rs/crate/rusqlite/0.40.2)
(released 2026-08-08; upstream 0.41.0 released 2026-10-24) continues to own
connections and transactions; [rusqlite_migration 2.6.0](https://docs.rs/crate/rusqlite_migration/2.6.0)
(released 2026-05-28) continues to own migrations. [SQLite WAL persistence](https://sqlite.org/wal.html#persistence_of_wal_mode)
already supplies the required behavior across connections. No helper or dependency
is added. [Shared-cache mode](https://sqlite.org/sharedcache.html) was rejected:
it changes locking semantics and SQLite discourages its use. Separate connections
and WAL already meet the requirement.

## Linux diagnostic

Ubuntu 24.04.5, Linux x86_64, AMD EPYC 9V74, four CPUs, rustc 1.99.0
`b940084d7eb6a299eb4bfeb8e34901bc051e7ac4`, LLVM 23.1.1. Release profile remains
`lto="thin", codegen-units=1`, as #3807 already implemented. Both release builds
use `cargo build --release -p rupd` and exit 0.

Temporary timers on the reference, ten fresh Projects, give these median spans:

| Operation | ms |
|---|---:|
| Image materialization (`seed_fresh`, including fsync/link) | 1.3934 |
| Initial `Connection::open` | 0.1620 |
| Initial WAL/schema access | 0.8557 |
| Migration version check | 0.0175 |
| Touches redundant WAL/schema access | 0.5792 |
| Todos connection / redundant WAL/schema access | 0.0678 / 0.5623 |
| Checkpoints connection / redundant WAL/schema access | 0.0565 / 0.5648 |
| Pads connection / redundant WAL/schema access | 0.0655 / 0.5426 |
| Rail connection / WAL/schema access | 0.0671 / 0.5621 |
| Timing connection, before recovery | 0.0698 |
| Digest WAL/schema access | 0.5274 |
| Messages connection / WAL/schema access | 0.0563 / 0.5439 |

The four schema-function checks take 0.0005–0.0017 ms. Their WAL calls account for
about 2.25 ms. Instrumented spans are attribution, never gate timings. Rail's
terminal-id cleanup, legacy kinds, terminal-node removal, flattening, closed
preparations/copies and provisioning recovery remain eager; Timing still
interrupts retained intervals, Digest reloads cursors, Messages migrates removed
holds and Asks settles interrupted placement/delivery. Those stores need their
schema for recovery, so omitting their pragmas merely shifts initialization into
the first recovery query and is not claimed as a saving. Event log retains the
migration connection. Publications and Reactions already open without an eager
query; Terminals opens no database. Recovery and asynchronous watcher work can
overlap; no total residual is attributed by subtracting these medians.

## Alternating release comparison

Five warm-up starts per side precede nine rotating pairs of ten fresh Projects
per side: reference/head on odd pairs, head/reference on even pairs. Builds and
checks had stopped. All 18 measured invocations exit 0; no sample is skipped.
The one-minute host load is 1.5933 (0.3983 per CPU) throughout the short session.
Values are medians of invocation medians, in milliseconds:

| Span | Reference | Repair |
|---|---:|---:|
| First matching ping, parent wall time | 11.912830 | 11.153102 |
| Daemon open | 9.465 | 6.905 |
| Storage | 2.407402 | 2.338253 |
| Base stores | 1.431100 | 0.245747 |
| Agents and recovery | 1.676216 | 1.684955 |
| Services | 2.136502 | 1.008751 |
| Messages and recovery | 1.603997 | 1.596306 |

Daemon open improves about 2.56 ms; first-ping wall time improves about 0.76 ms.
Startup watchers can force some deferred schema reads before the first ping;
the four isolated pragma spans must not be added to predict an end-to-end gain.
The independent wall observer includes process loading, scheduling and readiness.
No claim about the remaining Mac cost follows from their difference. The clean
integration merge `b41df7acea0109cdb0f666405ff44a5e296d4562` changes none of the
measured Rust files, manifests, lockfile or release settings.

## Observer and reproduction

`storage::tests::r3696c_idle_project_stores_do_not_read_the_schema_on_open` opens
a migrated Project database, holds SQLite's exclusive lock, and opens the four
stores through their existing public interfaces. A schema read attempts a lock
and fails. On the reference it fails with `DatabaseBusy` at Touches; with the
repair all four open in about 0.010 s. It starts no process and asserts no clock
threshold. The lock is diagnostic input, not a new product concurrency promise.
The existing `n16_all_stores_share_one_project_database` proves writes and reads
across reopen; schema/identity equivalence and standalone behavior tests remain.
The edited test file contains no duplicate or compiler-proved tests to remove.

[Raw evidence](perf-startup-connections.json) retains the complete probe and
pair driver, temporary timer patch, diagnostic logs, binary hashes, environment,
loads and every sample/exit. Reproduce with fresh worktrees at the two full SHAs
above; build each with `cargo build --release -p rupd`, then copy their binaries
to `/tmp/4052-reference-rupd` and `/tmp/4052-head-rupd`. Extract the drivers:

```sh
python3 - <<'PY'
import json, pathlib
record = json.loads(pathlib.Path('docs/perf-startup-connections.json').read_text())
for name in ('probe', 'pairs'):
    pathlib.Path('/tmp/4052-' + name + '.py').write_text(record['scripts'][name])
PY
# Stop all build/check work before timing.
python3 /tmp/4052-pairs.py /tmp/startup-pairs.json /tmp/4052-reference-rupd /tmp/4052-head-rupd
```

For instrumented attribution, apply `diagnostic.patch` from the JSON to the
reference worktree, build it with the same release command and run the retained
probe for ten starts. The patch is temporary; no instrumentation ships here.
Each start owns fresh Project/data/socket paths, fixes Tokio workers at four,
polls the socket every 0.1 ms and ends timing on its matching `daemon.ping`.
It sends SIGTERM after observation and reaps its process group; `process_exit=-15`
is intentional, while `exit=0` means the probe completed successfully.

These are Linux diagnostics, never a same-M4-Max pass. #4052 closes on the repair
and evidence merging. #3696 keeps full R3696c, the residual Rail gate,
unchanged-code false-fail evidence and the separate later main pass. No budget,
baseline, felt limit, RPC, scenario or listing-sidecar behavior changes.

Validation: 434 reached tests pass (five existing skips), including
`u3523f_runtime_is_lazy_bounded_and_reaped`; `just lint-rust` passes, including
`ALL PROOFS CHECK`; `merge-loss` passes. `pnpm install` completed. All
`just lint-web` lines pass except the current main size violation:
`loop/builder.py` has 1455 newlines against frozen ceiling 1453. This is tracked
by [#3937](https://github.com/roundup-app/roundup/issues/3937); no frozen file,
ceiling or exception is changed here. The new document's shortened-SHA spelling
failure was corrected by recording full SHAs; the remaining boundary diagnostic
is solely that existing main violation.
