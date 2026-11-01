> R5460: the Message receiver lookup and B32 tests described here are retired; measurements below are historical.

# Fresh Terminal owner query work (#1754)

This repair replaces `nodes_terminal(terminal_id)` with SQLite's covering partial index `nodes_terminal(terminal_id, attempt) WHERE terminal_id IS NOT NULL`, in Agents migration 2. The query, `LIMIT 2`, prepared-statement reuse, owner facts, callers and Rail → Attempts → callback cut remain unchanged. SQLite maintains the index in the same transaction as each lifecycle write; it is not an application ownership cache. Each call still starts and ends a fresh read transaction. Unattached nodes no longer occupy this index; positive reads obtain the persisted Attempt without seeking into the nodes table.

```text
Rail → Attempts → bind Terminal → fresh indexed SELECT → current Status → callback
                                  one index cursor
unlock → caller schedules delivery
```

Before selecting the repair, temporary release instrumentation split binding from the first SQLite step. The latter accounts for 4.386–4.506 µs of the initial 4.752–4.787 µs query span. Strace shows a fresh WAL reader `F_RDLCK`/`F_UNLCK` pair immediately before each unowned owner-read trace; the retained traces include every syscall, not a sampled summary. Holding a transaction across calls would preserve an old snapshot, so this repair keeps those locks. EXPLAIN on bundled SQLite 3.53.2 shows the unnecessary work: the original plan opens both the nodes table and Terminal index, with a deferred table seek for positive reads. The new covering plan removes the table cursor and deferred seek. Plans and opcodes for every seam fixture are retained.

References: before production is main `69c7a594`; the before seam build adds only the new regression test (`e534ee9b`); after is `f63f2c31`. `sources.json` resolves full references and hashes every Agents source/migration plus build configuration and lockfile. `repair.patch` contains the change. This host is Ubuntu 24.04.5, AMD EPYC 9V74, four online/available CPUs, affinity 0–3: **a different class from #1754's earlier EPYC 7763 evidence**. No cross-class comparison or ceiling verdict is made. Rust 1.99.0, committed lockfile, default release profile, no compiler flag overrides; complete OS/kernel/CPU/toolchain/shell metadata and binary hashes are retained.

Diagnostic live-Daemon medians, µs; all 2,200 User calls per Daemon, warmups included:

| Reference | Daemon | Bind | First step | Query | Whole owner resolution |
|---|---:|---:|---:|---:|---:|
| Before | 1 | .231 | 4.427 | 4.752 | 5.438 |
| Before | 2 | .320 | 4.386 | 4.777 | 5.468 |
| Before | 3 | .200 | 4.506 | 4.787 | 5.468 |
| After | 1 | .280 | 4.647 | 5.018 | 5.789 |
| After | 2 | .170 | 4.286 | 4.5465 | 5.228 |
| After | 3 | .210 | 4.366 | 4.667 | 5.318 |

The first after Daemon is slower; it is retained. The initial index experiment is also retained (whole-owner medians 5.238, 5.438, 5.438 µs). These wall times attribute work and are **not performance acceptance**. Instrumentation writes only after releasing both lifecycle locks and was reversed before production tests/commits. Column medians need not sum: the whole span also includes instrumentation and statement cleanup. Unowned callbacks do no Message store work; these spans say nothing about Agent/Door Message transactions.

A separate temporary release microbenchmark surrounds the uninstrumented retired Message receiver lookup method at its existing seam. Every fixture runs 20,100 calls, retaining all values and marking the first 100 as warmup. Three fresh fixtures per case, two alternating before/after invocations, all medians in ns:

| Case | Before invocation 1 | After invocation 1 | Before invocation 2 | After invocation 2 |
|---|---|---|---|---|
| Unowned, empty Rail | 2574, 2584, 2584 | 2494, 2484, 2493 | 2534, 2444, 2534 | 2533, 2554, 2524 |
| Unowned, 40 nodes | 2603, 2594, 2594 | 2483, 2483, 2494 | 2604, 2564, 2564 | 2534, 2524, 2544 |
| Owned, 40 nodes | 2974, 2974, 2974 | 2784, 2764, 2784 | 2954, 2944, 2964 | 2815, 2814, 2815 |

The median of six fixture medians falls 3.3% for the unowned 40-node case and 5.7% for the owned case. Empty-Rail results overlap. This narrow microbenchmark supports the removed query work; it does not substitute for the unchanged write probe or historical acceptance. Its callback only checks owner presence, not Message transactions. The full temporary test is `bench.patch`, outside production source.

The **unchanged, uninstrumented User/Extension/User probe** is `../owner-read/isolate.py`, SHA-256 `7cf9bc902121eeb4e94ddee16ef332d7034bf3da8279bc6938d1690d4bb3d331`. Each invocation starts three fresh Daemons, seeds 40 empty Workstreams, and uses 100 warmups plus 1,000 measured writes per Actor. Echo waits remain outside the timed call. Exact commands/exits, every raw sample, all metrics and stderr are retained. No build or test was running during these observations. Write p95, µs:

| Reference | Daemon | Load / CPU at start | User | Extension | User again |
|---|---:|---:|---:|---:|---:|
| Before 1 | 1 | .6039 | 66.488 | 54.380 | 66.829 |
| Before 1 | 2 | .6039 | 67.140 | 56.203 | 66.628 |
| Before 1 | 3 | .5754 | 68.671 | 64.615 | 65.367 |
| After 1 | 1 | .3615 | 70.183 | 54.601 | 67.330 |
| After 1 | 2 | .3615 | 65.818 | 56.914 | 66.679 |
| After 1 | 3 | .3615 | 66.778 | 54.941 | 68.020 |
| Before 2 | 1 | .2585 | 67.119 | 56.304 | 68.571 |
| Before 2 | 2 | .2578 | 67.991 | 56.824 | 63.274 |
| Before 2 | 3 | .2578 | 66.018 | 48.342 | 61.801 |
| After 2 | 1 | .2004 | 66.999 | 56.573 | 76.363 |
| After 2 | 2 | .2004 | 66.999 | 56.353 | 63.984 |
| After 2 | 3 | .2004 | 66.879 | 52.858 | 63.483 |

This probe does **not demonstrate a write p95 improvement**. Slower observations and every outlier remain retained. All live-Daemon observations qualify under the unchanged 2.0 Linux load/CPU threshold. The first strace observer failed during wrapper shutdown (exit 1); its traceback and traces remain, though shutdown prevented the JSON report from being written. A detached-tracer repeat completed with its full report (exit 0). There were no busy uninstrumented observations. Exploratory Python/system-SQLite measurements, including an mmap experiment with no improvement, are retained as diagnostic investigation only, not substituted for bundled-SQLite or live-Daemon results.

#1366 still owns nine alternating eleven-Daemon historical/repaired invocations after this repair: all metrics/per-run values, absolute limits, ten login shells, 1,000 calls, 100 warmups, 10% plus existing noise, the 2.0 load/CPU threshold, RSS at every load, and retained/repeated busy or failed observations. #1361 owns combined latency acceptance; #1251 owns independent class calibration/completion. No baseline, workload, threshold or gate changes here.

The fresh-Attempt regression test uses the retired Message receiver lookup after another connection commits an Attempt change. It fails the retained deliberate `SELECT id, 0` mutation (exit 101) and passes restored reads. The migration test proves version-1 rows/sequence/payloads survive migration 2 and the exact new index is installed; removing migration 2 fails it (exit 101), restoring it passes. Existing B32 tests retain fresh positive/negative reads, ambiguity/recovery, SQL errors without a callback, callback errors/lock release, concurrent attachment/detach/reassignment/removal/reopen/Attempt changes, pending Resume and running/failed/closed receiver Status facts. The SQL/callback/Message semantics are unchanged.

## Retained evidence and reproduction

`observations.json.gz` is a JSON mapping from filename to complete UTF-8 contents. It retains reports, every sample, trace, patch, metadata, command/exit/hash row, validation log, preliminary experiment and failed observer. Binary bytes are not committed; their SHA-256 hashes are retained. Extract to a fresh directory:

```sh
python3 - <<'PY'
import gzip, json, pathlib
source = pathlib.Path('crates/agents/r16/owner-query/observations.json.gz')
out = pathlib.Path('/tmp/owner-query-retained')
out.mkdir(exist_ok=False)
for name, contents in json.loads(gzip.decompress(source.read_bytes())).items():
    (out / name).write_text(contents)
PY
```

Reproduce in detached worktrees at the full before/after references in `sources.json`, using fresh targets. Build `cargo build --release -p rupd`, then run the unchanged `crates/agents/r16/owner-read/isolate.py <binary> <fresh-report.json>` on each binary. Apply the corresponding `instrument-before.patch`/`instrument-after.patch` only for diagnostic builds, record their reports separately, then reverse the patch. For the seam microbenchmark, apply `bench.patch` at either reference, build `cargo test --release --lib -p agents r16_owner_read_attribution --no-run`, then run the resulting test binary with `--ignored --nocapture r16_owner_read_attribution`. Both forms print only after timed calls. Retain every output and repeat busy/failed observations without replacing files. `commands.jsonl` has exact observed commands, directories, flags, environment and exits; early rows record load at command end, the live probe reports also record each Daemon's start load. Source patches identify temporary build trees separately from their references.

Validation and readiness remain incomplete until prerequisite [#1761](https://github.com/saadshahd/roundup/issues/1761) repairs the Daemon and shared migration fixture observers, which freeze schema/version 1. This PR retains the shared tests; it does not copy or weaken them to accept its migration. #1754 remains open and this PR stays draft. Final command results are retained in the archive and PR body.

Final validation at the measured production source: `pnpm install --frozen-lockfile` passes; Agents/Message nextest with no fail-fast runs 853 tests (848 pass, five shared migration-observer failures, two unchanged skips); `just proofs` exits 0 with `ALL PROOFS CHECK`; vocabulary exits 0. `just check` passes formatting/Clippy, then exits 100 at the shared N10 observer. Its default fail-fast leaves later Rust tests and web checks unrun. No check is represented as passing from this incomplete run. Full logs and exit rows remain retained.

Main sync: merged `09cfa05c` (Checkpoint storage, plus its Cargo.lock additions). Agents production source and migrations still match measured `f63f2c31`; `main-sync.json` retains hashes and incoming/diff statistics. The performance reports describe their recorded pre-sync binaries, not a new whole-Daemon observation after this merge. The post-sync `just check` result is retained separately as `post-main-check.log`.

The post-sync check also exits 100 at shared N10 (62 passed, one failed, five inherited suite skips; 1,670 later tests unrun). Formatting and Clippy pass again; web checks remain unreached. Final vocabulary passes. These results do not complete #1754.
