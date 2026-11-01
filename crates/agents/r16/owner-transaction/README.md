> R5460: the Message receiver lookup and B32 tests described here are retired; measurements below are historical.

# Fresh Terminal owner transactions (#1901)

A bounded schema-only companion read lets SQLite share its in-process WAL read lock. Every authoritative owner lookup still starts and ends its own fresh read transaction under Rail → Attempts, using the unchanged cached `SELECT id, attempt FROM nodes WHERE terminal_id = ? LIMIT 2` and covering partial index. The companion never reads owner rows or supplies facts to a callback. Callers, constructor signatures, SQL owner facts and the lifecycle cut stay unchanged.

```text
Rail → Attempts → fresh indexed owner SELECT → record → unlock
                  SQLite shares a local WAL lock
schema read → sleep 5 ms → rollback → discard one queued wake → wait
```

One companion belongs to each Rail. It waits without opening a connection until the first wake, retains four prepared statements, uses a one-slot unit channel and zero SQLite busy timeout, and attempts maintenance at most once per 5 ms sleep interval. A lease starts only after a successful complete passive checkpoint. Both active and skipped attempts sleep before another wake; input cannot extend a lease. An idle Rail releases its snapshot without another call, and dropping the Rail disconnects and joins its companion before closing the authoritative connection. A companion failure logs once and ends the optimization; the authoritative query and its errors remain the only source of owner facts. SQLite owns the lock protocol and snapshot validation ([WAL concurrency](https://sqlite.org/wal.html#concurrency)).

## References and host

Final matched before: `177cce1082ada0049d8a527839e8ec1e90c5d172`. Measured integrated implementation: `4d8a58281590b8cdfda1d374a48cc6a2b99db87c` (repair commit `589ce998`, then main's B6 Resume cleanup repair #1897). `sources.json` and `machine.json` identify this final pair. The original discovery and diagnostics used `7063788d` and `6234d2e0`; their source/binary hashes, patches and complete observations remain separately identified in the archive. The final matched comparison was repeated after the B6 merge. Later commits repair only test-clock observation and retain evidence. Later main syncs change Chromium observer tools and App Token sources; Daemon production sources remain unchanged from the measured implementation.

Ubuntu 24.04.5, AMD EPYC 7763, four online/available CPUs, affinity 0–3; Rust 1.99.0, bundled SQLite 3.53.2, default release profile, committed lockfile, no compiler-flag overrides. Complete OS/kernel/CPU/toolchain/profile/environment metadata is retained. This is a same-host comparison; no class calibration or baseline changes occur.

Uninstrumented Daemon SHA-256:

| Reference | SHA-256 |
|---|---|
| Before | `e1b63f7dc5eebf56dcf41a8ae8fc1938db84b5cc3842d19724d713c35c420027` |
| After | `69d20327775c8fa297a3ec0e6d4ea8c22b753e9a0169c3c89b01017ae15db47c` |

## Attribution before repair selection

The retained bundled-SQLite C fixture separates binding, first step, second-step/decoding interval and reset/clear work. For the original SQL, three first-step medians are 2.385, 2.395 and 2.384 µs, versus 0.040 µs binding and 0.040 µs reset/clear. A separate schema-snapshot control lowers those first-step medians to 1.152, 1.142 and 1.132 µs. Its complete syscall traces show one reader lock/unlock pair between each of 17 adjacent sample markers before, and zero in the peer-read control. That unbounded control is diagnostic only; the production companion uses fixed expiry and complete-backfill admission.

The alternate `LIMIT`-free SQL saves one unowned VM instruction but leaves unowned owner-interface medians flat; its owned change is small. Every sample, including its slower last C round, remains in the archive. The original SQL is retained. The production owner statement still opens only its covering index, with no nodes-table cursor or positive table seek; every fixture retains its query plan and opcodes. All companion statements are compiled once before its loop.

## Uninstrumented owner-interface observations

Two alternating before/after invocations, three fresh Agents fixtures per case in each invocation. Each fixture retains all 20,100 outer-timer values; only the predefined first 100 are warmups. The method has no timing instrumentation, and the callback only asserts owner presence. These are owning-module spans, not Agent/Door Message transactions or combined write acceptance. No compilation or test suite ran during these observations.

All six fixture medians, µs:

| Case | Before | After | Reduction in median of fixture medians |
|---|---|---|---|
| Unowned, empty Rail | 2.705, 2.706, 2.705, 2.725, 2.735, 2.736 | 0.631, 0.641, 0.631, 0.642, 0.651, 0.651 | 76.4% |
| Unowned, 40 nodes | 2.705, 2.705, 2.705, 2.725, 2.735, 2.736 | 0.631, 0.631, 0.631, 0.642, 0.651, 0.651 | 76.6% |
| Owned, 40 nodes | 3.056, 3.055, 3.046, 3.076, 3.066, 3.055 | 0.882, 0.882, 0.891, 0.882, 0.891, 0.882 | 71.1% |

## Unchanged User/Extension/User probe

`../owner-read/isolate.py`, SHA-256 `7cf9bc902121eeb4e94ddee16ef332d7034bf3da8279bc6938d1690d4bb3d331`, is unchanged. Each invocation starts three fresh Daemons, seeds 40 empty Workstreams, and uses 100 warmups plus 1,000 measured writes per Actor, with echoed-output waits outside the timed call. Every raw probe value, report, stderr, exit and start/end load remains retained. Two alternating before/after invocations use the frozen uninstrumented binaries above.

Write p95, µs:

| Reference | Invocation / Daemon | Load / CPU at start | User | Extension | User again |
|---|---|---:|---:|---:|---:|
| Before | 1 / 1 | 0.34448 | 118.992 | 105.547 | 119.022 |
| After | 1 / 1 | 0.33691 | 119.002 | 107.320 | 116.758 |
| Before | 1 / 2 | 0.34448 | 117.750 | 107.811 | 118.381 |
| After | 1 / 2 | 0.33691 | 117.459 | 107.361 | 122.166 |
| Before | 1 / 3 | 0.33691 | 122.268 | 109.525 | 120.165 |
| After | 1 / 3 | 0.32983 | 119.163 | 97.776 | 121.486 |
| Before | 2 / 1 | 0.32983 | 104.847 | 114.316 | 102.953 |
| After | 2 / 1 | 0.32336 | 119.994 | 107.792 | 116.797 |
| Before | 2 / 2 | 0.32983 | 119.173 | 106.108 | 118.612 |
| After | 2 / 2 | 0.32336 | 118.141 | 108.002 | 116.518 |
| Before | 2 / 3 | 0.32336 | 120.205 | 99.897 | 111.072 |
| After | 2 / 3 | 0.31738 | 113.322 | 106.088 | 116.899 |

All final performance observations qualify under the unchanged 2.0 Linux load/CPU threshold and exit 0. There are no busy or failed final performance observations to repeat. Slower observations and ceiling misses are retained; none was discarded or retried. The write results are mixed and establish no write p95 improvement. Pre-sync matched observations, initial before, rejected SQL and companion-prototype observations remain separately identified, with all raw values. No workload, budget, noise allowance or baseline changes occur.

## Separate release diagnostics

These diagnostics precede the B6 main sync and identify before `7063788d` and after `6234d2e0`; final acceptance uses the matched post-sync uninstrumented pair above. The temporary before/after patches split cached preparation, binding, first step, remaining row processing, Rows drop and cached-statement drop. Each fresh Daemon retains every one of 2,200 unowned User calls, warmups included. Logging occurs after both lifecycle locks are released, outside the outer owner timer. Each column is an independent median and need not sum to whole resolution.

Medians from the three fresh Daemons per reference, µs:

| Span | Before | After |
|---|---|---|
| Cached preparation | .541, .531, .451 | .531, .451, .471 |
| Bind | .461, .531, .451 | .451, .451, .471 |
| First step (including fresh read transaction and its unowned completion) | 6.482, 6.462, 6.582 | 3.367, 3.366, 3.357 |
| Remaining row processing | .070, .080, .070 | .070, .070, .070 |
| Rows drop | .060, .060, .060 | .050, .030, .040 |
| Cached-statement drop | .481, .441, .460 | .501, .441, .511 |
| Whole owner resolution | 8.416, 8.475, 8.405 | 5.450, 5.310, 5.310 |
| Unowned callback | .080, .090, .090 | .080, .080, .040 |

These binaries and their instrumented probe output supply attribution only, never performance acceptance. They do no Agent/Door Message store work. Their source patches and binary hashes are retained; both patches were reversed before final checks. The uninstrumented acceptance binaries retain their original hashes.

## Regression coverage and validation

The retired external-attachment test warms a negative read, holds an independent older schema snapshot, commits attachment/Attempt from another connection and checks the fresh owner through the retired Message receiver lookup.

`b32_owner_read_leases_expire_independently_of_input` observes uncopied WAL frames to witness an active reader, then proves another connection can truncate the WAL both after input stops and while input continues. A two-second expiry mutation fails with uncopied frames, exit 101; restored expiry passes. The first observer confused a competing checkpoint's `(1, -1, -1)` with an active reader; that failed run and the corrected observer remain retained. The original red test, full red check, all patches and exits remain retained.

All existing regressions remain: cold/warm positive and negative reads, ambiguity/recovery, SQL errors without callback, callback effects/errors, lifecycle lock order, concurrent attach/detach/reassignment/removal/reopen, pending Resume and current Status/Attempt/revision facts. No original test is cut or replaced. Both new tests use the existing owner interface; no test-only production seam is added.

The pre-sync `just check origin/main` exits 0: 1,445 affected Rust tests and all 55 reached web tests pass, with five Rust and two web existing skips. The first post-sync check exposed a paused-clock Resume observer: its virtual clock could expire real PTY cleanup before exit was observed, returning UNKNOWN_OUTCOME instead of CONFLICT. The unchanged failing test also fails in isolation. Restoring wall time immediately after the virtual acknowledgement deadline preserves all production bounds and outcome assertions; all 14 A22 and six A23 tests pass. Those observer repairs are test-only. The failed check, isolated failure and passing repeats remain retained; the integrated repeat passes in `final-integrated-check.log`. After the final main sync, `publish-check.log` records `just check origin/main` exit 0: all 1,449 Rust tests and all 55 reached web tests pass, with five Rust and two web existing skips. Proofs print `ALL PROOFS CHECK`; vocabulary exits 0. Formatting, Clippy, other lint/type checks and contract freshness pass. All validation commands, failures and repeats remain retained.

#1366 owns the post-repair nine alternating eleven-Daemon historical/current comparisons, every metric and per-run value, historical absolute limits, ten login shells, 1,000 calls, 100 warmups, 10% rule, existing noise, 2.0 Linux load threshold, RSS at every load, and retained/repeated busy or failed observations. #1361 owns combined latency acceptance; #1251 owns independent class calibration and completion. This repair supplies the owning-module reduction only.

## Retained evidence and reproduction

Read-back verified all 171 retained files. Archive SHA-256 `3b3633280c9f788b7b941255606bb5acfc40fac7e144f0bdc373d0f2272b4aef`; decoded JSON SHA-256 `451909f7bf17f24b9cf580f895d0757892f0b9f46aa670e48fa8136186ca377f`.

`observations.json.gz` is a JSON mapping from filename to complete UTF-8 content. It retains raw reports/samples/traces, patches, reproduction sources, exact commands/exits, loads, toolchain/profile/machine metadata, source/binary hashes and validation logs. Binary bytes are excluded; their hashes are retained. Extract to a fresh directory:

```sh
python3 - <<'PY'
import gzip, json, pathlib
source = pathlib.Path('crates/agents/r16/owner-transaction/observations.json.gz')
out = pathlib.Path('/tmp/owner-transaction-retained')
out.mkdir(exist_ok=False)
for name, content in json.loads(gzip.decompress(source.read_bytes())).items():
    assert pathlib.Path(name).name == name
    (out / name).write_text(content)
PY
```

Use detached worktrees at the full before/after references, the recorded toolchain, release profile and affinity, and fresh targets. Build `cargo build --release -p rupd`, freeze/hash each binary, then invoke the unchanged `isolate.py` alternately on them as `measure-synced.sh` records. For outer owner spans apply `bench-synced-before.patch` before or `bench-synced-after.patch` after, compile `cargo test --release --lib -p agents r16_owner_read_attribution --no-run`, and run its resulting test binary with `--ignored --nocapture r16_owner_read_attribution`. For the separately identified pre-sync diagnostics only, check out their references and apply the corresponding `instrument-before.patch` or `instrument-after.patch`, build/freeze a separate binary, run the probe, then reverse the patch. Every invocation uses a fresh output name. Retain and repeat busy/failed observations without overwriting them. `commands.jsonl` and the initial command ledger preserve observed commands and exits; `sources.json`, `machine.json`, `main-sync.json` and the patches identify every source and binary variant.
