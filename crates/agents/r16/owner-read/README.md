# Terminal owner-read attribution (#1686)

At main `4b75b448378a626ec630fb192e2a10e124675c6b`, measure before selecting the repair. On Ubuntu 24.04, EPYC 7763, four online/available CPUs and affinity 0–3, SQL preparation accounts for 11.0–11.5 µs of the 18.7–19.6 µs authoritative owner-read span. The repair changes only `Rail::terminal_owner`'s `prepare` to `prepare_cached` (`dd980f90`). rusqlite's bounded connection cache retains compiled SQL, not owner results. Every invocation binds its Terminal and executes the indexed SELECT, including the second-row ambiguity check, under the existing Rail → Attempts → callback cut.

```text
with_terminal_owner
  lock Rail → lock Attempts
  reuse compiled SQL → bind Terminal → execute fresh SELECT
  resolve current Attempt/Status → record input
  unlock → caller schedules delivery
```

The Statement and Rows stay local. A successful read, negative read, query error or callback error releases them before the next call; no owner fact authorizes later mutation. Callers, SQL, callback error/transaction semantics, delivery and events are unchanged. No Rail presentation, owner cache, public interface, budget, baseline or workload changes.

Diagnostic attribution, µs (median of all 2,200 User writes per fresh Daemon, warmup retained):

| Reference | Daemon | Rail lock | Attempts lock | Prepare/reuse | Query | Whole owner resolution | Callback |
|---|---:|---:|---:|---:|---:|---:|---:|
| Before | 1 | .040 | .070 | 11.041 | 6.843 | 18.746 | .089 |
| Before | 2 | .070 | .071 | 11.291 | 6.823 | 18.995 | .110 |
| Before | 3 | .040 | .069 | 11.482 | 7.203 | 19.602 | .111 |
| After | 1 | .090 | .060 | .472 | 7.174 | 8.435 | .091 |
| After | 2 | .070 | .060 | .521 | 7.243 | 8.552 | .090 |
| After | 3 | .070 | .060 | .491 | 7.104 | 8.406 | .050 |

The median of the three owner medians falls 55.6%; preparation/reuse falls 95.7%. Query execution remains near 7 µs. The whole span includes instrumentation/statement cleanup, so column medians need not sum to it. Timing output happens after both locks are released. Instrumentation is temporary, applied identically to both references, retained as patches, and removed from production. Its wall times are not acceptance.

The exact uninstrumented User/Extension/User probe from [#1366](https://github.com/saadshahd/roundup/issues/1366#issuecomment-6159637475) is retained unchanged as `isolate.py` (SHA-256 `7cf9bc902121eeb4e94ddee16ef332d7034bf3da8279bc6938d1690d4bb3d331`). Each invocation starts three fresh Daemons, seeds 40 empty Workstreams, and performs 100 warmup plus 1,000 measured writes per Actor. The echo wait stays outside the timed call. Within each invocation all Actors use the identical uninstrumented binary. Build/test commands had exited before each observation.

Uninstrumented write p50 / p95, µs; all invocations exit 0:

| Reference | Daemon | Load / CPU at start | User | Extension | User again |
|---|---:|---:|---:|---:|---:|
| Before | 1 | 1.110 | 104.090 / 132.569 | 79.298 / 97.172 | 98.309 / 131.376 |
| Before | 2 | 1.110 | 101.300 / 127.660 | 80.857 / 98.334 | 111.138 / 129.513 |
| Before | 3 | 1.041 | 99.377 / 129.372 | 77.931 / 98.344 | 105.934 / 130.144 |
| After | 1 | .640 | 88.526 / 113.352 | 77.309 / 102.267 | 90.434 / 112.300 |
| After | 2 | .640 | 85.538 / 108.135 | 79.852 / 100.635 | 86.274 / 111.977 |
| After | 3 | .640 | 91.832 / 111.369 | 73.497 / 84.798 | 85.304 / 109.455 |

These separate before/after observations support the attribution, not a historical latency verdict. The host is a distinct class from #1366's earlier 9V45 observations. All twelve fresh-Daemon observations (six uninstrumented, six diagnostic) are below the unchanged 2.0 load/CPU threshold; none was busy or failed. Raw samples, including outliers and every metric the isolation probe collects, are retained. No absolute or historical ceiling pass is inferred from this isolation probe.

#1366 retains the required nine alternating eleven-Daemon historical/repaired comparisons after this repair: every metric, per-run value, load, exit, hash, command, toolchain/profile and machine metadata; ten login shells, bounded calls, echoed output, existing absolute limits, 10% plus existing noise, 2.0 Linux threshold, RSS at every load, misses and repeated busy/failed observations. #1361 owns combined latency acceptance; #1251 owns independent class calibration and completion observations. None is completed here.

`observations.json.gz` contains a JSON mapping from filenames to complete contents: all four probe reports (every raw value), twelve stderr logs, before/after timing patches, source/binary hashes, metadata, exact commands/exits, build logs, test logs and the deliberate failing mutation. Extract without losing any samples:

```sh
python3 - <<'PY'
import gzip, json, pathlib
root = pathlib.Path('crates/agents/r16/owner-read')
out = pathlib.Path('/tmp/owner-read-retained')
out.mkdir(exist_ok=True)
for name, contents in json.loads(gzip.decompress((root/'observations.json.gz').read_bytes())).items():
    (out/name).write_text(contents)
PY
```

Builds use Rust 1.99.0, default release profile, committed Cargo.lock and no compiler-flag overrides. `metadata.json` records full references, OS, kernel, CPU, online/available count, affinity, shell, toolchain and SHA-256 hashes. `commands.jsonl` records exact commands, working directory, exit and relevant environment. The before release build includes the tests-only working-tree additions later committed as `348a2a12`; they are entirely under `cfg(test)` and excluded from release binaries. Its production source equals the recorded main reference. The after binary is built from `dd980f90`'s production source. Metadata distinguishes reference hashes from the before build tree; the diagnostic patches apply to `348a2a12` and `dd980f90`, respectively. `repair.patch` is the complete production change. `instrument.py` reproduces the diagnostic patch; it is never used by ordinary builds.

To reproduce the performance observations from this PR's checkout, with a fresh output directory and fresh targets per reference:

```sh
crates/agents/r16/owner-read/reproduce.sh /tmp/owner-read-reproduction HEAD
```

The reproduction leaves its detached worktrees and binaries for inspection. Retain and repeat any busy/failed observation; never replace a retained file or treat a busy observation as clean. The isolation probe does not decide regression acceptance.

Regression tests use the existing `Agents::with_terminal_owner` seam:

- `b32_repeated_owner_reads_bind_each_terminal_afresh`: alternating positive/negative Terminal parameters.
- `b32_a_warm_owner_read_rejects_ambiguity_then_recovers`: a fresh conflict after a successful read; no callback; recovery after detach. A temporary `LIMIT 1` mutation fails this test (exit 101); restoring `LIMIT 2` passes.
- `b32_a_warm_owner_read_fails_on_sql_error_without_recording_input`: schema loss after a negative read fails without a callback and releases lifecycle locks.
- Existing `b32_concurrent_*` tests warm the query before concurrent attachment, detach, reassignment, removal, reopen and Attempt changes; `b32_pending_resume_*`, `b32_running_and_failed_*` and `b32_closed_receiver_*` assert fresh Resume/Status facts. Existing callback failure and Message scenarios retain transaction/error, fencing, input tail, submit/clear, handover and receiver-binding coverage.

Main sync: merged `7892de16fb5d02440add6f651268d0ed5d30608b`; the measured Agents source hashes still match. The incoming changes are specifications and loop machinery, with no production Rust or build changes. The PR diff against that main stays entirely in `crates/agents/`. The complete passing pre-merge check is retained. A post-merge single-worker repeat passed all Rust tests but was intentionally interrupted (exit 130) during the first browser file because serializing the suite was a poor observer setting. Its log is retained. The default-worker post-merge repeat then passed Rust but hit the existing 5-second timeout in two unchanged web tests (`u135_reduced_motion_makes_every_duration_but_the_instant_changes_0s` and `u470_hide_and_reopen_keep_scope`). Both complete files passed in isolation (51 tests). A two-worker full repeat passed all Rust tests, then was gracefully stopped during web tests (exit 130) before the workflow’s 105-minute model limit. At that head the full post-main check remained incomplete; no tests were skipped and no timeout changed. Both interrupted runs and the failed default-worker report are retained.

Validation: `pnpm install --frozen-lockfile`, `cargo test -p agents -p messages`, `just proofs` (`ALL PROOFS CHECK`), `loop/rules.sh vocab` and `just check`. Complete exits/logs are in the retained evidence.

Completion: this fix run merged main `114fe273`, kept the diff wholly in `crates/agents/`, and completed `VITEST_MAX_WORKERS=2 just check` (exit 0): 1,664 Rust tests and 2,874 web tests pass; 11 web tests remain skipped by the unchanged suite. The earlier U135/U470 timeout cases pass in this full run. `just proofs` prints `ALL PROOFS CHECK`; vocabulary passes. Complete logs and commands/exits are retained as `fix-full-check.log`, `fix-proofs.log`, `fix-vocab.log` and `fix-validation.json` in the archive. Earlier observations remain intact.
