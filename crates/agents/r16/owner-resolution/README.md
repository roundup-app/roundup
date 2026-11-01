> R5460: the Message receiver lookup and B32 tests described here are retired; measurements below are historical.

# Remaining Terminal owner work (#1913)

The existing the retired Message receiver lookup cut still locks Rail → Attempts, executes the identical fresh indexed owner query, records synchronously, then releases the locks. No owner facts are cached. Callers, constructors, SQL facts, callbacks and Message store behavior are unchanged.

```text
input → first wake → complete-backfill admission → schema-only read → 5 ms → rollback → rearm
        pending input skips channel submission
        every input still binds and executes the authoritative owner SELECT
```

One atomic boolean coalesces channel submissions for the entire pending/running attempt. The consumer rearms after rollback or a skipped attempt's fixed sleep, before waiting for another input. It does not read or publish owner facts; relaxed atomic ordering is sufficient because the boolean controls only admission and the existing channel publishes the unit wake. The queue remains `std::sync::mpsc::sync_channel(1)`; channel disconnect still wakes shutdown and Drop still joins the peer. A failed peer only disables the optimization. Fixed expiry, complete-backfill admission, schema-only peer reads and the four retained peer statements remain unchanged.

The owner statement still comes from rusqlite's prepared-statement cache, with identical `SELECT id, attempt FROM nodes WHERE terminal_id = ? LIMIT 2`. Rusqlite 0.40.2's safe `raw_bind_parameter(1, terminal)` and `raw_query()` bind the fixed one-parameter statement without the generic binding path's repeated `sqlite3_bind_parameter_count`. Rows and cached statements retain their normal cleanup. No hand-written SQL protocol or unsafe code is introduced. Existing library reuse: [rusqlite's binding interface](https://docs.rs/rusqlite/0.40.2/rusqlite/struct.Statement.html#method.raw_bind_parameter) and [Rust's bounded channel](https://doc.rust-lang.org/std/sync/mpsc/fn.sync_channel.html); `research.md` retains considered alternatives.

## Source, host and method

Before: `8f4aeda29da2b1580c3672d830296e82964beeca`. Final implementation: `c9620ce2` (full reference and file hashes in `sources.json`). Subsequent evidence commits do not change production source. Ubuntu 24.04.5, AMD EPYC 7763, four online/available CPUs, unrestricted affinity 0–3, Rust 1.99.0, bundled SQLite 3.53.2, default release profile and committed lockfile; no flag overrides. `machine.json` retains complete CPU, OS, kernel, toolchain, environment and profile metadata.

Every final comparison alternates before/after on this host. Nine invocations per reference, each with three fresh Agents fixtures per case and three fresh Daemons for the existing User/Extension/User probe. Owner fixtures keep all 20,100 values, with only the predefined first 100 as warmups. Their timer surrounds the uninstrumented method and a callback asserting owner presence, outside any Agent/Door Message transactions. Each probe Daemon seeds 40 empty Workstreams and performs 100 warmups and retains 1,000 measured writes per Actor, with echo waits outside the timed call. `crates/agents/r16/owner-read/isolate.py` is unchanged, SHA-256 `7cf9bc902121eeb4e94ddee16ef332d7034bf3da8279bc6938d1690d4bb3d331`. No build, test suite or proof process ran during these observations. There is no baseline, workload, budget or noise change.

## Attribution before selection

Temporary release diagnostics retain every one of 2,200 unowned User calls on each of three fresh Daemons. Logging follows callback and both lifecycle-lock releases. The instrumented binaries and their probe output supply attribution only. Before selecting the repair, both lifecycle locks, peer wake, cached preparation, binding, first step, remaining row work, Rows drop and cached-statement return were measured separately. Each column is an independent median; columns need not sum to the whole.

| Span | Before medians, ns | Final medians, ns |
|---|---|---|
| wake | 130.0, 160.0, 130.0 | 50.0, 60.0, 60.0 |
| prepare | 511.0, 541.0, 490.0 | 481.0, 481.0, 501.0 |
| bind | 511.0, 521.0, 481.0 | 450.0, 451.0, 411.0 |
| step | 3296.0, 3176.0, 3306.5 | 3226.0, 3186.0, 3246.0 |
| row | 70.0, 70.0, 70.0 | 70.0, 70.0, 70.0 |
| rows-drop | 30.0, 40.0, 31.0 | 31.0, 40.0, 40.0 |
| statement-drop | 531.0, 521.0, 541.0 | 430.0, 471.0, 471.0 |
| rail-lock | 110.0, 110.0, 91.0 | 81.0, 100.0, 80.0 |
| attempts-lock | 60.0, 60.0, 60.0 | 60.0, 70.0, 70.0 |
| whole | 5480.0, 5430.0, 5430.0 | 5119.0, 5200.0, 5170.0 |
| callback | 90.0, 91.0, 80.0 | 91.0, 81.0, 90.0 |

The first candidate coalesced wakes only. Its two alternating invocations leave unowned owner medians flat and reduce owned medians 2.4%; all results remain under `wake-only/`. Its separate diagnostics reduce wake medians to 50–60 ns but whole spans are mixed (`attribution-after.json`). The final candidate also avoids the redundant parameter count. The initial direct-binding comparison and all final observations remain separately retained; no earlier result was overwritten to select faster samples.

## Uninstrumented owner observations

Median of the 27 fixture medians per case:

| Case | Before, ns | After, ns | Reduction |
|---|---:|---:|---:|
| unowned-empty | 641 | 621 | 3.1% |
| unowned-40 | 641 | 621 | 3.1% |
| owned-40 | 882 | 861 | 2.4% |

Every fixture's median, p95, covering-index query plan and opcode listing is in `summary.json`; all raw values including warmups are in `before-seam-<1..9>.log` and `after-seam-<1..9>.log`. The unchanged SQL opens its covering index and no nodes-table cursor. Cached compilation and fresh positive/negative reads remain intact.

## Unchanged User/Extension/User probe

Each cell below is the median of the three fresh Daemons' write p95 values for that invocation, in µs. These summaries discard no raw observation: all 54 per-Daemon triples, all 162,000 measured call values, loads, stderr and command exits remain in `summary.json` and the `*-probe-*.json` files.

| Invocation | Before User / Extension / User | After User / Extension / User |
|---|---|---|
| 1 | 118.421 / 105.297 / 120.556 | 118.892 / 109.264 / 119.093 |
| 2 | 121.597 / 105.988 / 120.912 | 118.642 / 106.489 / 119.163 |
| 3 | 119.764 / 110.877 / 120.395 | 120.174 / 107.731 / 120.766 |
| 4 | 119.744 / 105.227 / 117.800 | 117.850 / 106.389 / 117.599 |
| 5 | 119.343 / 100.752 / 120.716 | 119.733 / 99.817 / 120.951 |
| 6 | 119.223 / 106.158 / 117.393 | 120.342 / 107.551 / 119.430 |
| 7 | 119.386 / 100.929 / 118.632 | 118.491 / 106.829 / 118.972 |
| 8 | 120.595 / 112.867 / 119.253 | 119.816 / 107.962 / 116.679 |
| 9 | 117.691 / 91.360 / 117.530 | 120.095 / 107.020 / 117.550 |

All 36 final owner/probe commands qualify under the unchanged 2.0 Linux load/CPU threshold, maximum start/end load/CPU 0.581055, and exit 0. No final performance observation is busy or failed, so none needs a repeat. Every slower result is retained; no ceiling miss is removed or retried. The User write p95 medians across Daemons are 119.343 / 118.713 µs before versus 119.801 / 118.972 µs after, so this establishes no User write p95 improvement. This is a narrow owner-resolution reduction only. #1366 retains its historical/current eleven-Daemon comparisons and RSS/absolute-limit acceptance; #1361 owns combined acceptance, and #1251 owns independent calibration and completion observations.

Uninstrumented Daemon SHA-256:

- before: `cb4c437521999d9e4216c63d126de5dd5940ebdc34584466501f55622e949f7f`
- after: `2ec82b66c27bcc562d1cba03fba7dc004ea11f53722b0416d70d04f6b1569081`

## Regression coverage and validation

`b32_owner_read_leases_expire_and_rearm_independently_of_input` extends the existing expiry proof with a second burst on the same Agents instance after a completed checkpoint. Both stopped and continuing input must expire each lease and admit a subsequent lease. Omitting the rearm store fails with exit 101; restoring it passes. `red-no-rearm.patch`, the complete red/green logs and exits remain retained. The existing expiry assertions are preserved; no test is cut and no duplicate regression is added. The repeated-terminal binding proof passes on the final uninstrumented seam binary. Existing fresh positive/negative, ambiguity/recovery, SQL/callback errors, external commits, lifecycle transitions and receiver Status/Attempt/revision proofs remain unchanged.

`just check origin/main` exits 0: 1,455 affected Rust tests pass (five existing skips), including Agents and Message scenario tests; 55 reached web tests pass (two existing skips). Formatting, Clippy, linting, type checks and contract freshness pass. Both the separate `just proofs` and the check's proof run print `ALL PROOFS CHECK`; vocabulary exits 0. `final-check.log`, `proofs.log`, `final-vocab.log` and `commands.jsonl` retain exact commands, outputs and exits. `production-integrity.json` confirms production and probe hashes still match the measured sources after validation.

## Retained evidence and reproduction

`observations.json.gz` is a JSON mapping from relative filename to complete UTF-8 content. It contains every raw sample/report/stderr, commands/exits/loads, reproduction scripts, source patches, metadata, source/binary hashes, red/green and validation logs. Binary bytes are excluded; their hashes are retained. The original wake-only measurements were moved under `wake-only/` before the final phase; original command paths in the ledger refer to those files. `measure-final.log` identifies the 36 final commands by exact timestamps, and `summary.json` retains them separately as `final_commands`. Initial builds and both diagnostic-only candidates remain separately identified. The first unused before build's hash is `before-initial.sha256`; acceptance uses the clean `before-frozen-build` result and `binary-hashes.json`. `initial-commands.json` identifies initial setup commands that preceded the command recorder.

Extract into a fresh directory:

```sh
python3 - <<'PY'
import gzip, json, pathlib
source = pathlib.Path('crates/agents/r16/owner-resolution/observations.json.gz')
out = pathlib.Path('/tmp/owner-resolution-retained')
out.mkdir(exist_ok=False)
for name, content in json.loads(gzip.decompress(source.read_bytes())).items():
    relative = pathlib.PurePosixPath(name)
    assert not relative.is_absolute() and '..' not in relative.parts
    target = out / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
PY
```

For uninstrumented Daemons, use detached worktrees at the full before/final references from `sources.json`, the recorded toolchain and profile, and `cargo build --release -p rupd`; freeze/hash the binaries. For outer owner spans only, apply `bench-before.patch` before or `bench-after.patch` after (the final production source has the same test file as that patch's base), then `cargo test --release --lib -p agents r16_owner_read_attribution --no-run`; freeze/hash its test executable. Run it with `--ignored --nocapture r16_owner_read_attribution`. Neither owner-method instrumentation nor diagnostics enter these binaries. Invoke the unchanged `isolate.py` on each frozen Daemon as `measure-final.py` and `commands.jsonl` record. Use fresh output names and no competing build/test/proof work; keep every miss and repeat failed/busy observations without overwriting them.

For separate attribution only, apply `diagnostic-before.patch` to the before reference, `diagnostic-after.patch` to `02028527`, or `diagnostic-final.patch` to the final reference. Build separate release binaries, run the same probe, and reverse those patches before any acceptance build. `instrument.py` and `instrument-final.py` reproduce the instrumentation. Diagnostic logging is outside the lifecycle cut. `binary-hashes.json` identifies every instrumented and uninstrumented executable. No diagnostic source remains in production.

Archive read-back verifies all 218 files and every final owner/probe sample count. Archive SHA-256 `8f8606b1159263dde510dc442d06c5eea1058787e3edd5f5747d941b30e70ec0`; decoded JSON SHA-256 `bbcaa8f870f671b596fca1d07e944d7dac93ed22ce213fd644f93ea851680711`.
