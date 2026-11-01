# macOS `cold_start_ms` and `rail_tree_40_p95_ms` (#3696)

Neither is a spawned `ps`: `resources.rs` runs only for `daemon.resources` and `scan.rs` only with a live Door, and `strace -f -e execve` of a fresh `rupd` shows one `execve`, so the lazy sidecar adds no spawn at start. Measured on one Linux machine at one load, `just perf` at the macOS baseline commit `02fd86775` against `main`: `rail_tree_40_p95_ms` 0.25 against 0.71 ms, `ping_p95_ms` 0.046 against 0.093 ms, `cold_start_ms` 14 to 16 against 24 ms. The Daemon itself got slower after the baseline, as the Mac's ratios show.

- `rail.tree`: `Shared::present` read each node's `finished` with `WHERE CAST(id AS TEXT)=?`, a full scan per node, and `load_nodes` parsed its SQL on every call. A tree read now takes one `finished_all` query and prepares both statements once; 0.71 became about 0.49 ms.
- `cold_start_ms`: a fresh Project replays 37 migrations into `project.db` (`storage::open`), 11 to 12 ms of DDL parse and `ALTER TABLE` schema checks; an existing Project starts in 10 ms against 24 ms for a fresh one. `PRAGMA synchronous=OFF` saves 1 ms and `legacy_alter_table` nothing. `build.rs` now migrates an empty database once at build time (`VACUUM INTO`), and `storage::open` copies that image when `project.db` does not exist, giving the two per-Project ids (`deliverable_project`, `reaction_project`) fresh values. `r3696c_a_fresh_project_db_equals_the_migrated_one_with_its_own_identity` holds the image equal to the migrated database. No budget changes; the Mac's `target/perf.json` is the observer.

- `rail_tree_40_p95_ms` after the batched read, per call inside the Daemon (release, 40 Workstreams, a Linux machine at load 1.2 per CPU): `Shared::tree` 90 µs (`load_nodes` 55 µs, of which the `closed_sources` subquery is 12 µs; presenting 8 µs), then `serde_json::to_value` of the 16.5 KB reply 90 µs, then the writer's `to_vec` 17 µs. `daemon.ping` is 19 µs in the Daemon. Rewriting the subquery uncorrelated and reading `kind` without an allocation moved `load_nodes` by under 3 µs, within noise, so neither is kept. The largest remaining share is the `Value` tree that every `Module::call` reply passes through; removing it (a pre-serialized reply that `dispatch` and the connection writer carry without a `Value`) changes the `Module` seam and is the next repair, not a budget change. This measurement needs no Mac; whether it brings the Mac's 0.338 ms under 0.149 ms is the Mac's `just perf` to say.

- Mac run at `6ce9103e2` (`cold_start_ms` 10.54, `rail_tree_40_p95_ms` 0.220, `rss_extra_mb` 3.81; the first two were 16.87 and 0.338 before the repairs above). Two more repairs, both measured without the Mac:
  - `rail.tree` reaches the socket as JSON text written from the typed nodes (`Module::call_reply`, `rpc::Reply::Json`, `connection::Frame::Json`), with no `serde_json::Value` tree between: `rail_tree_40_p95_ms` on a loaded Linux machine (load 3 to 5 per 4 CPUs) 0.62 against 0.54 ms through the same client, `rail_tree_10_p95_ms` 0.25 against 0.22. Every other method still returns a `Value`; `r3696c_a_rail_tree_reply_written_directly_equals_the_value_route` holds the two replies equal.
  - `cold_start_ms`: a fresh start made 12 `fsync` calls (`strace -f -e fsync`): three SQLite commits at about four each (the seeding `UPDATE`, and the switch of `project.db` to WAL mode). The image is now stored in WAL mode, so `storage::open` writes nothing, and the seeded copy is written with `synchronous=OFF` then synced once before it is linked: 1 `fsync`. A fresh start went from 16.1 to 17.1 ms down to 14.6 to 14.8 ms (15 starts each) on a filesystem where `fsync` is cheap; `fsync` costs more on APFS, so the Mac's gain should be larger. The remaining start is CPU: about 0.6 ms for each of the 17 stores opening `project.db`, 2.4 ms for `Agents::open`.
  - `rss_extra_mb`: ten Terminals grow the Daemon by 2.85 MB of anonymous memory on Linux (about 285 KB each: two `vt100` grids, the output ring, two threads). No cause of the Mac's rise from 3.1 to 3.81 is established, and no change is claimed. The Mac's next `target/perf.json` is the observer.


- Mac A/B at `bca7dc582` against the baseline `02fd86775` (9 runs each, one session, #3696): `cold_start_ms` 16.51 against 5.91 ms, `rail_tree_40_p95_ms` 0.1926 against 0.1237, `rss_extra_mb` 3.50 against 3.11, `ping_p95_ms` 0.0411 against 0.0193; the baseline reproduced its recorded numbers. Every request, `daemon.ping` included, costs about 22 µs more than at the baseline, so part of `rail.tree`'s 69 µs is the shared request path and not the read. The Linux attribution of a fresh start (release, 4 CPUs at load 4): `rupd` is 7.3 ms from `open_stores` to the socket, `storage::open` 2.5 of it (seed 1.7, WAL switch 0.4) and 17 `project.db` connections about 0.4 ms each. Tried and not kept: opening the independent stores on threads made a start 2 ms slower; dropping the per-store `PRAGMA journal_mode=WAL`, or reading it first, only moves the 0.06 ms of WAL setup per store to its first query. Kept: the fresh `project.db` image takes its two ids by replacing placeholder bytes in the copy (`storage::reidentified`), so a start opens no connection, `-wal` or `-shm` to seed; a fresh start went from 8.1 to 7.9 ms (median of 40 starts, each side alternating), more where file creation costs more. The Mac's `target/perf.json` stays the observer; the rest of the 10.6 ms is not attributed.

- Per-phase cold start (#3696): `rupd` now ends its `serving` line with `(open X ms, bound Y ms)`, measured from `main`: `open` is `Daemon::open_project` (stores, plugins), `bound` the socket. The gap between `cold_start_ms` and `bound` is process spawn, runtime start and the first ping round trip. On the Mac, run `RUPD_SOCKET=/tmp/x.sock ROUNDUP_DATA_DIR=$(mktemp -d) target/release/rupd $(mktemp -d)` at the baseline `02fd86775`'s successor commits and `main` to attribute the 10.6 ms.

- Per-request cost (#3696), found by profiling `daemon.ping` in a release `rupd` on Linux (`perf record`, 150 000 pings), no Mac needed. Each request paid for work no request needs: `Daemon::start_pushes` built a `Reader` for the waker and again for the evaluator (a module-map copy plus a `getenv`) before checking there were events to hand them, and `Auto::start` built one more before checking it had already started; and `daemon.ping` built its `contract.methods` (about 300 names, sorted, then one `String` each) as a `Value` every call. The readers are now built only when there are events, and `daemon.ping` writes its reply as JSON text with the Contract part rendered once (`builtin::ping_json`, `r3696c_a_ping_written_directly_equals_the_value_route`). A ping round trip from a plain client went from 43 to 28 us (baseline `02fd86775`: 20 us; its reply was 14 bytes, today's is about 8 KB, which accounts for the rest and for `ping_p95_ms` having no baseline). `rail.tree` at 40 Workstreams shows no change beyond noise on Linux (130 us either side through a Python client), so the Mac's 0.069 ms gap there is the read itself, which has grown with the fields the Rail now loads; `Shared::tree` is 90 us of it above.
- Binary size, a hypothesis only the Mac can test: release `rupd` is 34.3 MB against 5.6 MB at `02fd86775` (`reqwest` with `rustls`, `axum`, `notify`, `regex`, bundled SQLite). On Linux a start costs 1.4 ms more (10.3 against 11.7 ms to the first ping); macOS pays at exec for every page it validates against the code signature and for the rebase of every pointer in the data segments, so size may be most of the Mac's 10.6 ms. The `serving` line's `bound` time against `cold_start_ms` separates that (spawn and load) from `open` (stores and plugins).

- Cold start's remaining Mac cost (#3696), attributed from the Mac runs already on this Issue: `cold_start_ms` was 10.54 ms at `6ce9103e2`, whose fresh start paid SQLite's 12 plain `fsync` calls, and 15.65 to 16.51 ms at `bca7dc582`, after `fdfad6b6c` replaced them with one `std::fs::File::sync_all` of the seeded image. Rust's `sync_all` is `fcntl(F_FULLFSYNC)` on macOS, which waits for the drive to flush its cache and costs several ms on APFS, more than the 12 plain `fsync` calls it replaced; on Linux it is `fsync`, so the Linux measurement could not show it. `seed_fresh` now calls `rustix::fs::fsync`, the plain `fsync` SQLite itself uses, so no `F_FULLFSYNC` runs at start. The Mac's `target/perf.json` is the observer; the ping and `rail.tree` per-request gap and `rss_extra_mb` are not attributed by this change.


- Retained Terminal memory (#3696): `460203cfa` added cell source annotations for X14. On this Linux x86_64 runner, ten 80×24 idle `vt100` parsers retain 949,600 heap bytes, including 921,600 bytes of 48-byte cells. The pre-annotation cell was 32 bytes: 307,200 extra bytes for ten grids, independent of machine load. These annotations are used by Output replay; the live screen retains the same cell representation even when it has no annotations. This explains an allocation increase, not the entirety of the Mac's measured RSS change (3.109 to 3.500 MB); RSS also includes allocator residency and the added output channels. R3696c now stores each opaque source value as eight bytes and its presence in the unused length bit: a cell is 40 bytes, preserving `None`, zero and `u64::MAX`, all text capacity, and screen/history dimensions. `r3696c_ten_idle_terminal_grids_retain_under_850_kb` measured 796,000 retained heap bytes after the repair, saving 153,600 bytes per ten idle grids. It runs without a Daemon or clock. Existing edit/replay tests cover source movement and invalidation; the literal `Cell == 48` test assertion was removed because the library's compile-time size assertion already catches representation growth and the new observer checks actual parser allocation. No Mac RSS pass, baseline rebase or complete R3696c pass is claimed. The later same-M4-Max `just perf` and per-phase startup attribution remain required.

### Retaining startup attribution (#3696)

`just perf` keeps each cold-start Daemon's stderr beside its report: with the default output,
`target/perf.startup-1.log` through `target/perf.startup-11.log`; with
`--out target/mac/current-1.json`, `target/mac/current-1.startup-1.log` through
`target/mac/current-1.startup-11.log`. The CLI prints the path before each run,
and an observer failure retains the log even when no JSON report can be written.
The parent opens the file before timing cold start and passes its descriptor directly
to the Daemon, with no pipe collector or extra process. This replaces `/dev/null`;
metric calculations and `budgets.json` do not change.

The `serving` line's cumulative times are measured from entry to async `main`:
`open` covers `Daemon::open_project`, and `bound - open` covers socket setup.
`cold_start_ms - bound` includes process creation/loading, Tokio runtime startup,
readiness polling and the first ping; it is **not** a pure process-load measurement.
Plugin materialization is deferred to `Launcher::launch_on` at Agent launch, so no
plugin materialization occurs in this cold start. The separately timed
`cold_plugin_materialization_ms` is not part of `cold_start_ms`.

For the next same-M4-Max observation, retain these logs with `perf.json`, commit,
load and exit code. The last posted A/B (`bca7dc582` against `02fd86775`) predates
the plain-fsync repair and #3745's retained Terminal allocation repair. These logs
supply the missing in-process evidence; they do not establish a Mac pass or attribute
the entire remaining startup gap. The nine alternating same-session invocations,
commit-by-commit attribution, unchanged-code false-fail bar and separate later main
pass required by #3696 remain outstanding. No baseline rebase is justified here.

### Rail reply allocation (#3696)

The latest M4 Max A/B on #3696 (`59cff55cae` against `02fd86775`, nine
alternating invocations each) reproduces the baseline and still fails current
cold start (10.64 ms), Rail 40 (0.186 ms) and RSS growth (3.922 MB). The startup
logs give median open/bound times of 5.32/5.38 ms; neither these logs nor the
following Linux measurement attributes the entire remaining startup or RSS gap.

`e03234712` removes temporary allocations from Rail reads: rusqlite's borrowed
`ValueRef` supplies kind and Order text, traversal moves loaded nodes instead of
cloning them, and presentation formats a finish count only in the Status that
uses it. No result is cached. Through `Module::call_reply`, the ordinary
forty-Workstream reply allocates 290 times / 176,266 bytes, against 530 times /
181,047 bytes before the repair. `r3696c_forty_workstreams_avoid_temporary_node_copies`
uses the existing `stats_alloc` observer, with no Daemon, process or clock; its
400-allocation ceiling fails on the original path. Existing Rail ordering,
Order and Status tests cover the returned contents.

A separate release probe on Linux (four available CPUs, AMD EPYC 9V45) constructs
40 Workstreams, warms 100 reads, then times seven batches of 10,000 `Rail::tree`
reads. Two alternating before/after invocations, with builds and tests stopped,
gave median batch means of 38.35 us before (37.22–41.07) and 32.44 us after
(31.85–33.10), about 15% less construction time. This probe excludes live
presentation, JSON and transport; it is not the end-to-end Mac metric. The final
presentation change is included in the allocation observer, not this timing.
The saved allocations are temporary request work, not an explanation of idle
RSS. Budgets remain unchanged. R3696c's same-M4-Max full gate, remaining
attribution, false-fail evidence and separate later main pass remain open.

### Fresh-image search cost (#3696)

`reidentified` searches a 507,904-byte migrated image twice to replace the two
Project identities. `2a259871a` introduced a scalar comparison at every byte;
this startup work is independent of SQLite, process sampling and the listing
sidecar. `memchr::memmem::find_iter` replaces that scan, searching the immutable
image before copying replacement bytes. The image, synchronization, migration
fallback and budgets stay unchanged.

Linux x86_64, Intel Xeon Platinum 8573C, four available CPUs, rustc 1.99.0:
extract `reidentified`, `FRESH` and `IDENTITIES` from `storage.rs`, replace only
the RNG call with `random.fill(0x71)`, and compile with `rustc -O --edition 2024`.
Each invocation times seven batches of 1,000 copies, black-boxing every returned
image. The after probe links the existing release `memchr` rlib. With builds
and checks stopped, three alternating before/after invocations gave these
median batch means (ms per copy):

| Pair | Scalar scan | Library search |
|---|---:|---:|
| 1 | 0.68837 | 0.04957 |
| 2 | 0.68939 | 0.04981 |
| 3 | 0.69635 | 0.05155 |

The repair removes about 0.64 ms of Linux image preparation. It excludes RNG,
file writing, fsync, database opening and process startup; it is neither a full
cold-start timing nor Mac attribution. The existing
`r3696c_a_fresh_project_db_equals_the_migrated_one_with_its_own_identity` checks
schema/data equivalence, different Project identities and removal of every
placeholder. No new clock-sensitive test is added.

R3696c's full Mac gate, remaining startup/RSS attribution, false-fail evidence and
separate later main pass remain open. No baseline rebase is justified here.

### Entry startup baseline (R3800)

Production reference: `a284e11af9d48e9fad4f83fba29bfc757019e3e3`, Linux
x86_64, Node v22.23.3, pnpm 10.14.0, frozen lockfile. Both the ordinary
`pnpm --filter desktop build` and the metadata-instrumented build exited 0.
The entry is `assets/index-C_ycAV71.js`: 1,717,772 raw bytes and 505,299
bytes gzip at level 9. Its static chunk import list is empty, so those are
also the complete static-closure totals. This is a size observation, not a
cold-start timing or a performance pass.

The existing Vite 8 `generateBundle` metadata gives these leading dependency
contributions in that closure. `renderedLength` is before final chunk
minification; these values neither sum to emitted bytes nor predict gzip savings.

| Package | Rendered bytes |
|---|---:|
| @xterm/xterm | 411,320 |
| @dnd-kit/dom | 154,478 |
| @xterm/addon-webgl | 153,000 |
| @ark-ui/solid | 118,879 |
| overlayscrollbars | 76,437 |
| solid-js | 71,137 |
| @zag-js/splitter | 60,653 |
| marked | 50,037 |
| @xterm/addon-unicode11 | 38,494 |

Reproduce in a clean worktree at the reference: frozen `pnpm install`, then
`pnpm --filter desktop build`. For attribution, temporarily extend the existing
Vite config with a `generateBundle` hook that records each chunk's `fileName`,
`isEntry`, `imports`, `dynamicImports` and `modules`' `renderedLength` to JSON.
Follow only `imports` from the entry, once per file, group module ids by their
last `node_modules/` package segment, and sum rendered lengths. Compare the
ordinary and instrumented emitted entry bytes before using that map. Measure
actual files with `gzipSync(bytes, {level: 9}).length` from `node:zlib`.
The production checker must retain matching graph/module metadata with its build;
the temporary diagnostic config is not the checker.

Installed Vite already supplies dynamic imports, manifest static/dynamic edges
and bundler module metadata; Vite 8's chunk controls use
[`build.rolldownOptions`](https://vite.dev/guide/build), rather than assuming
Rollup's `manualChunks` API. Splitting a static dependency alone saves no budget.
For implementation's reuse audit, [size-limit](https://github.com/ai/size-limit)
14.3.0 was released 2026-10-22 and supports gzip file budgets;
[rollup-plugin-visualizer](https://github.com/btd/rollup-plugin-visualizer)
7.1.1 was published 2026-08-14 and exposes module attribution. Registry
`pnpm view <package> time --json` and the size-limit release/tag establish those
maintenance dates. The visualizer supplies diagnosis, not a required numeric
exit gate; size-limit's file selection still needs the entry's manifest closure.
Select maintained library capabilities before writing any adapter; do not reject
size-limit merely because a custom gzip loop is shorter. No checker library or
custom parser is implemented by this specification.

### Idle Terminal event rings (#3696)

The per-Terminal Tokio broadcast channel reserves 1,024 event slots at spawn,
including for a quiet program that has printed nothing. On Linux x86_64,
`EventData` is 88 bytes; each ring stored the complete application event enum
inline even though Terminals publish only titles and exits. Storing
`Arc<EventData>` in the same channel removes 80 bytes per slot, or 819,200 bytes
across ten queues. Capacity, lag reporting, ordering and exit delivery are still
Tokio's; no replacement channel or reduced backlog is introduced.

The allocation observer
`r3696c_ten_quiet_terminals_retain_under_800_kb` uses `stats_alloc` around ten
real `Terminals::spawn` calls with silent `/bin/cat` programs. Before this repair
it retained 1,311,686 heap bytes and failed the 800,000-byte cap; after it retains
492,346 bytes and passes (819,340 bytes less in this observation).
The programs receive no input, so screen parsers remain pending: this measures
the queues and spawn bookkeeping separately from the existing no-process parser
allocation observer. Each program is killed before the assertion, even on a
budget miss. No Daemon, socket or clock assertion is involved; the observer runs
in its own test binary so other tests do not contaminate its global allocator.

This identifies avoidable retained queue memory, not the origin of every byte
in the Mac's RSS rise. The saving is heap allocation on Linux, not a measured
Mac RSS saving. No baseline changes or full R3696c pass are claimed. Startup,
Rail, same-M4-Max observations, unchanged-code false-fail evidence and the
separate later main pass remain outstanding.


### Finish counts in the Rail read (#3696)

The ordinary forty-Workstream reply still read `nodes` twice: once for the
nodes and once for their finish counts, constructing an id-keyed map for the
second read. PR #3864 selects `finished` with the node and carries it through
the existing traversal. Presentation visits only reachable nodes, in the same
order as before; no result is cached. The public Rail and RPC replies stay the
same. The callback is internal to the existing Rail module.

The existing no-process allocation observer,
`r3696c_forty_workstreams_avoid_temporary_node_copies`, measures 290 allocations /
176,266 bytes on `a1d2169e3` and 245 allocations / 172,230 bytes after this
repair. Its cap is tightened from 400 to 260: it fails on the original path
and passes on the repair. This file holds only that observer, so no redundant
test is removed. Existing Rail ordering and
`u3566c_finish_count_survives_attempts_and_reopen` cover the returned facts.

Release probe: Linux x86_64, AMD EPYC 9V74, four available CPUs, rustc 1.99.0.
Use the allocation observer's fixture and instrumented system allocator, then
replace its measured call/assertion with seven batches of 10,000 awaited
`Module::call_reply("rail.tree", null)` calls, black-boxing every reply and
reporting elapsed time per call. Build both revisions before measuring. With
builds and tests stopped, three alternating before/after invocations gave
these median batch means (microseconds per reply):

| Pair | Separate finish map | Combined read |
|---|---:|---:|
| 1 | 77.023 | 67.238 |
| 2 | 78.204 | 67.546 |
| 3 | 76.847 | 67.110 |

One-minute load at invocation start ranged from 3.77 to 5.57 (0.94–1.39 per CPU).
This is about 13% less local reply work, including live presentation and JSON
serialization under the allocation observer. It excludes the Daemon's socket
transport and is not the end-to-end Mac metric or evidence of idle RSS savings.
Budgets are unchanged. The latest nine-pair M4 Max A/B at `59cff55cae` remains
the failing acceptance evidence; remaining startup/RSS attribution, full
same-M4-Max gate, unchanged-code false-fail evidence and the separate later
main pass remain open. This repair justifies no baseline rebase.

### Rail sort scratch space (#3696)

The stable sort in `Rail::tree_with` allocates scratch space for the loaded
`RailNode` values. A6 requires sibling orders to be unique; ties between
nodes with different parents do not affect parent-first traversal. Rust's
standard `sort_unstable_by_key` therefore preserves the reply order without
that scratch allocation. No traversal, cache or sorting implementation is
added.

On Linux x86_64 (AMD EPYC 9V45, four available CPUs, rustc 1.99.0), the existing
`r3696c_forty_workstreams_avoid_temporary_node_copies` observer measures 245
allocations / 172,230 allocated bytes on `f32419986`, and 244 / 132,294 after
this repair: 39,936 fewer temporary bytes per reply. Its new 150,000-byte cap
fails on the original path and passes on the repair. The existing
260-allocation cap remains because it catches the separate finish-map
regression. No test in this file repeats either proof or is removed. Existing
A6 Rail tests cover ordering and moves.

Release probe: replace the allocation observer's measured call/assertions with
seven batches of 10,000 awaited `Module::call_reply("rail.tree", null)` calls,
black-boxing each reply and retaining the instrumented allocator. Build both
revisions before measuring. Three alternating before/after invocations with
builds and tests stopped produced median batch means (microseconds per reply):

| Pair | Stable sort | In-place sort |
|---|---:|---:|
| 1 | 51.856 | 51.729 |
| 2 | 51.524 | 51.555 |
| 3 | 51.700 | 51.744 |

One-minute load at invocation start ranged from 3.80 to 4.81 on four CPUs.
These timings show no material speed change; the measured saving is allocation.
They include presentation/JSON and exclude socket transport.

This is temporary request allocation, not idle RSS attribution or a Mac timing
pass. Budgets remain unchanged. Full same-M4-Max acceptance, remaining
startup/RSS attribution, unchanged-code false-fail evidence and the separate
later main pass remain open; this repair justifies no baseline rebase.

### Deferred Terminal-owner worker (#3696)

Opening `Agents` created a `Terminal owner reads` thread even when no Terminal
ownership lookup followed. `Rail::terminal_owner` now initializes that same
helper on its first lookup, using standard `Option::get_or_insert_with` under
its existing exclusive borrow. The helper's bounded channel, read lease,
query and active deadline remain unchanged. Its channel's `recv_timeout`
replaces the lease sleep, allowing disconnection to release it at shutdown.
The retired sleep's exact lint-debt entry is removed, with no new exception. Its database path is retained
as a `PathBuf`, including for non-UTF-8 paths.

The Linux kernel observer
`r3696c_opening_agents_starts_no_owner_worker` counts `/proc/self/task`
entries around the public `Agents::open_with` call. On `e65989178`, startup
increased the count from two threads to three and failed; after the repair
the count stays unchanged and passes. It runs in a separate integration-test
binary without a Tokio runtime, child program or clock, so other test workers
do not contaminate the count. Existing Terminal-owner tests cover lookup
freshness and serialization with the helper active. No existing test was
removed: the new file contains only this startup observer.

This removes one thread creation from unused Project startup and idle life;
it does not measure milliseconds saved or resident stack pages. It is not
attribution of the entire Mac startup/RSS gap. No listing-sidecar change or
baseline rebase is involved. Budgets remain unchanged. The latest nine-pair
Mac A/B at `59cff55cae` remains the failing acceptance evidence; full M4 Max
acceptance, remaining attribution, unchanged-code false-fail evidence and the
separate later main pass remain open.

[Migration/Event-log connection handoff: measured repair and evidence](perf-sqlite-handoff.md).

### Runtime and store startup phases (#3696)

The retained `open`/`bound` line starts at entry to async `run`, after Tokio
creates its runtime. `rupd: runtime_ms <number>` measures the default
multi-thread runtime's creation separately; its worker count and enabled drivers
are the same as `#[tokio::main]`. No runtime tuning is made.

A `startup: stores <JSON>` record splits `Daemon::open_stores` into adjacent wall
intervals, in milliseconds:

| Field | Work included |
|---|---|
| `storage_ms` | Data-directory creation, fresh image preparation/synchronization, database open and migration check |
| `base_ms` | Event log, Terminal holder, Touches and Todos |
| `agents_ms` | Agents open, Rail recovery and timing store |
| `services_ms` | Checkpoints, Pads, digest/publication/reaction stores and Daemon holders |
| `messages_ms` | Module registration, Messages, Asks and starting event listeners |

These intervals partition the store-open function; Project path resolution and
legacy data relocation precede them. They do not partition process creation or
loader work. The parent cold-start measurement still includes readiness polling
and the first ping. Subtracting runtime and `bound` from `cold_start_ms` leaves
all those external costs and diagnostic output, not a pure spawn measurement.
Plugin materialization and listing-sidecar launch remain deferred and are absent
from these intervals. Records use standard `Instant`, existing serde_json and
the already-retained stderr descriptor; no collector or extra program is added.
Diagnostic formatting/writing occurs after the phase samples and remains part of
the end-to-end cold-start metric.

`r3696c_cold_start_reports_runtime_and_store_phases` starts an isolated real
Daemon, waits for the harness's first successful ping and reads the retained
numeric records. It failed before instrumentation because the phase record was
absent. The existing harness observer checks ping and cleanup; the perf CLI
observer separately proves stderr survives a failed startup. Neither proves
startup attribution.

This supplies attribution for the next Mac observation, not a performance
repair or full R3696c pass. The latest failing M4 Max A/B at `59cff55cae` predates
several repairs now on main. Remaining startup/RSS attribution, full same-M4-Max
acceptance with unchanged budgets, unchanged-code false-fail evidence and the
separate later main pass remain open. No baseline rebase is justified here.

### Fresh start store attribution (#4052, #3696)

Linux diagnostic, not a Mac pass. Reference and head base `e2c9e2db8f94f3fc16841ed453cb5c7dfe613024`;
AMD EPYC 7763, four CPUs, rustc 1.99.0, release `rupd`. A fresh start (`RUPD_SOCKET=$d/x.sock
ROUNDUP_DATA_DIR=$d/data rupd $(mktemp -d)`, killed after `serving`) spends about 10.4 ms in
`open`; the `startup: stores` line splits it into storage 2.9, base 1.5, agents 1.8, services
2.35 and messages 1.75 ms. Temporary timers inside `storage::open` split the 2.9 ms:
`seed_fresh` 1.85 (`reidentified` 0.6, write 0.4, `fsync` 0.8-1.2), the first connection's
WAL setup 0.9 (`-wal`/`-shm` creation and locking, paid by any first WAL access), migration
check 0.03. `strace -f` shows each of the 14 later `project.db` connections costing about
0.6 ms, unchanged by this work.

Cause of the 0.6 ms: `e8b68ed39` (DV2) built the image with 8 KiB pages, so it is 1,146,880
bytes (140 pages, 135 of them under 200 non-zero bytes), not the 507,904 the section above
measured; `reidentified` then copied all of it (`FRESH.to_vec()`, about 280 page faults) to
patch 64 bytes. It now returns the (offset, id) patches, and `write_image` writes the immutable
image around them: no copy, same bytes. The page size, `fsync`, link and WAL behaviour are
unchanged, and `r3696c_a_fresh_project_db_equals_the_migrated_one_with_its_own_identity` holds
the result equal to the migrated database with no placeholder left.

Thirty alternating old/new pairs (`docs/perf-startup-store-pairs.json`, raw samples, load 3.2 to
1.2, every run exited by the harness's kill after `serving`), medians: storage 2.90 against 2.60
ms, `open` 10.40 against 10.14 ms. About 0.3 ms saved on Linux; the Mac may differ. Not
attributed: the 0.9 ms WAL setup and 14 connections at 0.6 ms (about 8 ms), which a later
change must measure per store. No budget changed; R3696c's same-M4-Max gate stays on #3696.

[Four idle Project connections: measured repair and regression observer (#4052)](perf-startup-connections.md).
