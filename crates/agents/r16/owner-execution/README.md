> R5460: the Message receiver lookup and B32 tests described here are retired; measurements below are historical.

# Fresh Terminal owner execution (#1917)

The narrow repair removes redundant owner-query VM work. Its measurements do not establish User write p95 improvement or complete #1366, #1361 or #1251.

Each call still locks Rail → Attempts, performs a fresh authoritative read and records synchronously inside the lifecycle cut. No owner facts are cached; each SQLite read transaction ends within the method. The implementation only changes the existing SELECT; callers, constructors, schema/index, raw one-parameter binding, callbacks and the bounded schema-only peer are unchanged.

```text
Rail → Attempts → bind non-NULL text → fresh indexed SELECT → at most two rows → record → unlock
```

The SELECT is `SELECT id, attempt FROM nodes WHERE terminal_id IS ? AND terminal_id IS NOT NULL`. For the always-non-NULL `&str` binding, SQLite's `IS` has the same equality semantics as `=`. The explicit non-NULL condition retains the existing partial covering index. Rust already stops at the second receiver, so a SQL limit counter duplicates that bound. Bundled SQLite executes eight rather than ten VM instructions for a negative lookup: no `Integer` limit initialization, no nullable-parameter `IsNull` branch, no per-row `DecrJumpZero`. Owned reads also avoid the counter, but their measured owner-interface median is flat. Both retained plans say `SEARCH nodes USING COVERING INDEX nodes_terminal (terminal_id=?)`; both open only that index, never a nodes-table cursor. [SQLite equality semantics](https://www.sqlite.org/lang_expr.html#operators_and_parse_affecting_attributes) and [partial-index rules](https://www.sqlite.org/partialindex.html#queries_using_partial_indexes) support this use; actual plans/opcodes remain retained.

## Source and method

Before: `8001a5b04bd517af5e25679ca65e26070a44df3c` (main with #1914 and #1916). After: `b5b710937ebca9b53f7fb28b4e22b64de149de1b`. Later evidence commits do not alter production source. `sources.json` records file/lockfile/profile hashes; `binary-hashes.json` records every executed binary. Ubuntu 24.04.5, AMD EPYC 7763, four online/available CPUs with affinity 0–3, Rust 1.99.0, bundled SQLite 3.53.2, default release profile, committed lockfile, no compiler flag overrides. `machine.json` and `machine-extra.json` retain complete machine/toolchain/profile details.

Nine alternating before/after invocations, with three fresh Agents fixtures per owner case and three fresh Daemons per unchanged User/Extension/User probe. Owner timers surround the uninstrumented retired Message receiver lookup method and an asserting callback: 20,100 values per fixture, only the predefined first 100 treated as warmup. No Agent/Door Message transaction is timed by those fixtures. The separate unchanged `../owner-read/isolate.py` (SHA-256 `7cf9bc902121eeb4e94ddee16ef332d7034bf3da8279bc6938d1690d4bb3d331`) seeds 40 empty Workstreams per Daemon, uses 100 warmups and 1,000 retained writes per Actor, and waits for echoes outside the timed call. No competing build/test/proof ran during the matched observations. Diagnostic binaries never supply acceptance.

## Attribution before selection

On the repaired main source, three temporary diagnostic release Daemons each retain all 2,200 unowned User calls, warmups included. Logging follows callback and both lifecycle-lock releases. Medians in ns, each column independent:

| Span | Before: three Daemons | After: three Daemons |
|---|---|---|
| wake | 70, 50, 60 | 50, 60, 31 |
| cached preparation | 501, 561, 521 | 441, 541, 441 |
| binding | 471, 400, 511 | 411, 481, 431 |
| first step | 3407, 3376, 3396 | 3106, 3387, 3115 |
| remaining row work | 70, 70, 70 | 71, 70, 70 |
| Rows cleanup | 40, 41, 50 | 30, 40, 40 |
| cached-statement return | 501, 501, 481 | 490, 511, 421 |
| Rail lock | 111, 90, 71 | 80, 110, 81 |
| Attempts lock | 70, 70, 70 | 70, 70, 90 |
| whole owner cut | 5511, 5445.5, 5501 | 5009, 5531, 4969 |
| callback | 80, 80, 80 | 80, 100, 80 |

The pre-selection first-step medians (3,376–3,407 ns) dominate cleanup (40–50 ns Rows; 481–501 ns statement return). These instrumented spans are attribution only: the after diagnostics vary and are not a latency estimate or an additive decomposition of the whole.

A separate C control linked to the Daemon's exact bundled SQLite archive compares fresh stepping with stepping inside an existing read transaction. Before selection, fresh negative steps with a local schema-only peer are 391–401 ns for the original SQL and 381 ns for equality without LIMIT; steps inside an explicit transaction are 230 ns for both. That initial explicit-transaction control includes schema SELECT/BEGIN/ROLLBACK compilation in its setup/end spans (`c-attribution.log`); those spans do not isolate transaction duration. Cleanup is 40 ns. This identifies fresh transaction work as a material cost that must remain, while the redundant VM work can be removed. The three-way candidate control (`c-candidates.log`) retains original / equality-without-LIMIT / selected-SQL steps: 390/381/380, 390/381/381, 390/381/381 ns, with 10/9/8 VM steps respectively. Flat and slower raw samples remain retained.

A subsequent prepared-statement transaction control (`prepared-transactions.log`, six alternating rounds) separately retains BEGIN, schema step/reset, bind, owner step, reset/clear, and ROLLBACK timings. Original/selected owner steps are 170–171 / 161 ns; schema step/reset is 310–320 ns and ROLLBACK is 160 ns. The schema span includes schema execution as well as read acquisition; it is not a pure read-lock timer. Full syscall traces retain 17 between-sample intervals: every fresh no-peer interval has two reader-lock syscalls, versus zero with the schema-only peer. That unbounded peer is a diagnostic control only. Production retains its fixed 5 ms expiry, complete-backfill admission, coalesced wake, bounded queue and joined shutdown; there is no lock or transaction bypass.

## Matched uninstrumented owner observations

Median of the 27 fixture medians per case, ns:

| Case | Before | After | Reduction |
|---|---:|---:|---:|
| unowned-empty | 591 | 581 | 1.7% |
| unowned-40 | 591 | 581 | 1.7% |
| owned-40 | 831 | 831 | 0.0% |

`summary.json` retains all 162 fixtures, each median/p95, plan and opcode listing. All 3,256,200 timer values, warmups included, remain in the 18 `*-seam-<n>.log` files. The initial candidate owner observations remain separately retained; its exploratory EXPLAIN accidentally described the original SQL, so only the final matched `after-seam-<n>.log` plans describe the repaired query. Nothing was overwritten to choose faster samples.

## Unchanged User/Extension/User probe

Each cell is the median of three fresh Daemons' write p95s, µs. All 54 per-Daemon triples, 162,000 retained write values, other probe measurements, stderr, commands, exits and loads remain in the archive.

| Invocation | Before User / Extension / User | After User / Extension / User |
|---|---|---|
| 1 | 119.635 / 107.863 / 118.673 | 118.914 / 94.978 / 119.915 |
| 2 | 120.305 / 110.548 / 118.142 | 121.057 / 107.322 / 120.426 |
| 3 | 120.614 / 107.632 / 121.368 | 127.962 / 110.918 / 122.682 |
| 4 | 127.128 / 108.344 / 120.393 | 122.860 / 110.818 / 121.018 |
| 5 | 120.216 / 108.353 / 122.290 | 120.737 / 102.601 / 123.131 |
| 6 | 121.078 / 108.784 / 120.174 | 125.606 / 110.448 / 121.568 |
| 7 | 121.827 / 109.666 / 119.885 | 123.222 / 107.462 / 122.109 |
| 8 | 121.125 / 110.360 / 122.733 | 123.008 / 109.956 / 122.840 |
| 9 | 121.758 / 109.376 / 133.610 | 121.027 / 107.422 / 123.133 |

All 36 matched commands exit 0 and qualify under the unchanged 2.0 Linux load/CPU threshold; maximum start/end load/CPU is 0.6576. There are no busy/failed performance observations to repeat. Slower values are retained, including the before invocation 9 User tail and every slower after value; no ceiling miss was discarded or retried. This narrow probe has no historical ceiling gate and establishes no User write p95 improvement. No baseline, workload, budget or noise allowance changes.

#1366 retains responsibility for the post-repair nine alternating eleven-Daemon historical/current comparisons: every metric and run, absolute limits, ten login shells, 1,000 calls, 100 warmups, 10% rule, existing noise, 2.0 Linux load threshold, RSS at every load, and retained/repeated busy or failed observations. #1361 owns final combined latency acceptance; #1251 owns independent class calibration/completion. This prerequisite completes none of those Issues.

## Regression coverage

`b32_owner_read_stops_at_the_second_receiver` uses the existing owner interface and a SQLite view whose third row raises an error. CONFLICT, without callback, proves that Rust stops at the second receiver even without SQL LIMIT. A deliberate extra third step fails with INTERNAL (exit 101); the restored code passes. The mutation, red/green logs and commands are retained.

Rule 10 removes `b32_an_unowned_terminal_has_no_receiver`: the repeated receiver-read test proved the negative result, and the external-attachment proof retains its freshness. It also removes `b32_ambiguous_ownership_fails_without_recording_input`: `b32_a_warm_owner_read_rejects_ambiguity_then_recovers` still proves CONFLICT and callback exclusion, and the new test adds the distinct bounded-scan proof. No scenario is retired.

Existing proofs retain fresh positive/negative reads after external commits, ambiguity/recovery, SQL and callback errors, concurrent attachment/detach/reassignment/removal/reopen/Attempt changes, pending Resume, Status/revision fencing, callback effects and lifecycle lock order. The peer expiry/rearm test proves checkpoint progress after input stops and while it continues. No owner fact escaping the cut authorizes a later mutation.

Initial validation was blocked by existing prerequisite [#1920](https://github.com/saadshahd/roundup/issues/1920). Both `just check origin/main` invocations exit 1: each Rust suite runs 1,461 tests, with 1,460 passing and the unchanged `a35_a_ready_title_before_ack_still_delivers_the_reserved_prompt_first` timing out (10.407 / 10.344 s); five existing tests are skipped. Both reached web suites pass all 55 tests, with two existing skips. Formatting, Clippy, dependency checks, contract freshness and vocabulary pass; Message proofs print `ALL PROOFS CHECK` in both runs, without any law change.

The unchanged failing test passes alone in 0.79 s, but that does not settle the progress race. A baseline A35 group on `8001a5b04bd517af5e25679ca65e26070a44df3c`, with only failure-output diagnostics, reproduces it: 15 pass, one fails, outer nextest exit 100. The failure shows the reserved `rewind note` was typed and no bytes were dropped, but the following `pending Message` never arrives; the Terminal remains running with its ready title. This is the same ordering defect #1920 already owns. Its failure-only patch, source hash, complete log and command/exit are retained; no A35 or production repair from that worktree enters this branch.

The native prerequisite #1920 merged in #1921. This branch incorporates main `93ef7b52`: only reserved first-Steer admission and its A35 tests changed since the measured baseline. Owner-query source, lifecycle cut, constructors, schema, peer and benchmark fixtures did not change. The matched measurements above remain observations of their recorded source pair, not measurements of the merged head; no new write-latency claim follows from this merge. No test is weakened or skipped to get a green result.

Resumed validation after merging #1921: `pnpm install`, `just check origin/main` and `loop/rules.sh vocab` exit 0. All 1,462 reached Rust tests pass (five existing skips), including Agents, Message scenarios and the formerly failing A35 progress test. All 55 web tests pass (two existing skips). Formatting, Clippy, dependencies, contract freshness and Message proofs pass; proofs print `ALL PROOFS CHECK`. The complete resumed check/install/vocabulary logs and command/exit record are retained in the archive.

## Retained evidence and reproduction

`observations.json.gz` maps relative filenames to complete UTF-8 contents: every raw sample/report/trace, command/exit/load, diagnostic/benchmark patch, script, source/binary hash, machine/toolchain/profile record and validation log. Executable and SQLite database bytes are excluded; executed binary hashes are retained. `initial-commands.txt` records setup preceding the command ledger. `sources.json` and the patches identify each source variant; `production-integrity-before-measurement.json` records an empty production diff before acceptance measurements. The unused exploratory sqlite-step binary was never executed; its source is retained separately.

Extract into a fresh directory:

```sh
python3 - <<'PY'
import gzip, json, pathlib
source = pathlib.Path('crates/agents/r16/owner-execution/observations.json.gz')
out = pathlib.Path('/tmp/owner-execution-retained')
out.mkdir(exist_ok=False)
for name, content in json.loads(gzip.decompress(source.read_bytes())).items():
    relative = pathlib.PurePosixPath(name)
    assert not relative.is_absolute() and '..' not in relative.parts
    target = out / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
PY
```

For uninstrumented Daemons, use detached worktrees at the before/after refs above, the pinned toolchain/profile and lockfile, and `cargo build --release -p rupd`; freeze/hash their executables. For owner spans, apply `bench-before.patch` to before and `bench-after.patch` to after, compile `cargo test --release --lib -p agents r16_owner_read_attribution --no-run`, and freeze/hash each test binary. Run it with `--ignored --nocapture r16_owner_read_attribution`. These patches only add an outer-timer fixture, with no method instrumentation. Use the unchanged `isolate.py` alternately on frozen Daemons as `measure.py` records. Use fresh output names, retain all observations, and repeat busy/failed observations without overwriting them.

For diagnostics only, apply `diagnostic.patch` to before or `diagnostic-after.patch` to after, compile and freeze separate release binaries, run the unchanged probe, and reverse the patch before any acceptance build. `instrument-final.py` reproduces that instrumentation. The C fixtures link the same `libsqlite3.a` the release Daemon used; `initial-commands.txt` gives their exact commands. They never supply acceptance. `transactions.c` measures prepared transaction controls; `sqlite-attribution.c` and `sqlite-candidates.c` retain the earlier controls and all candidates.

Archive read-back verifies all 196 retained files and every matched sample count. Archive SHA-256 `c542ec80086e036b916995734fb63bdb80076c868e0cfe4c70704ec1855da99b`; decoded JSON SHA-256 `ea2395c5e5a8414303e689c50d5a53bf69526d6b430064a9fb07b85739407ba3`.
