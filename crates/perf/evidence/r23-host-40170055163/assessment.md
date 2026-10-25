# R23 assessment of the retained 9V45 lifetime

Assessment at `01e5e1b2e1578e8d9bb7119426c2e002aa51ef4a`; no new timing or
profile observation. PR #3963 supplied the qualified lifetime and raw evidence.
[README](README.md) identifies the host, toolchain, release settings, reference
commits, executable hashes and all failed attempts. [Reproduction](reproduce.txt)
retains the collection commands. The assessing Builder is a 9V74 and supplies
no substitute timing evidence.

## Compatibility boundary

One executable, `compatible-perf`, SHA-256
`d8f2865405b8a3bb4368aa68021fc4d7414696db4f0d2cec7375cd682e985844`,
measured both original Daemons. [compatibility.patch](compatibility.patch)
applies only to the scratch probe and its linked Client. It selects the Rail
creation spelling using an untimed ping; subscribes to historical Events before
spawning the echo Terminal; and translates historical `terminal.output` Event
data into `OutputFrame::Bytes` with an unused zero offset. The candidate keeps
its native output selection and readiness drain. Both original incompatible
cross-probe attempts exit 2; neither supplies a performance result.

The patch leaves `paced_writes` and `write_to_output` unchanged. Both references
therefore use ten login shells, raw `cat`, 100 warmups and 1000 timed calls for
each write metric, one echo before the next write, and eleven fresh Daemons.
The historical probe's original unpaced write loop is not used. H15 is omitted
after the writes for both references; this is not a full perf observation.

Identical executable bytes do not imply identical Client cost: the historical
Event adapter takes a different branch and deserializes the output data again.
This work is inside write-to-output timing and outside the explicit
`terminal.write` request timer's echo wait; concurrent output work can still
contend with request processing. No same-binary adapter-cost isolation was
collected. The reports compare the complete compatible observer, not isolated
Daemon service times. No Daemon-only improvement follows from these results.

## Timing calculation

For each metric, reference = median of three historical invocation medians;
ceiling = reference × 1.10 + 0.001 ms. These calculations use unrounded JSON
values. The table in `docs/perf.md`, R23 paired write conclusions, rounds only
for display. All six reports contain eleven samples for every metric and load;
all have an empty `skipped` list. Median load/CPU is 0.6325–1.3150.

| Metric (ms) | Historical reference | Ceiling | Candidate invocations exceeding |
|---|---:|---:|---:|
| terminal_write_p95_ms | 0.054052 | 0.0604572 | 0/3 |
| write_to_output_p95_ms | 0.110957 | 0.1230527 | 0/3 |

Every invocation median for write-to-output is below 16 ms. Cold start medians
are 10.896973–11.065354 ms (limit 300); extra RSS medians are 2.51171875–3.16796875
MB (limit 150). No absolute limit is missed in these reports. Individual
samples remain in JSON; regression decisions compare invocation medians.

All six observer exits remain **1**: the diagnostic scratch ceilings miss
`ping_p95_ms`, `rss_extra_mb` and `write_to_output_p95_ms` in every invocation.
Their exact values/ceilings remain in each `.stdout`, with the unrounded scratch
configuration in `diagnostic-budgets.json`. These copied boxd values are not
9V45 baselines. The write-to-output diagnostic miss and the passing R23 paired
ceiling answer different comparisons; neither exit nor evidence is rewritten.
All separate controls/profiles also exit 1, as indexed in README; failed builds,
RPC compatibility attempts and the denied runner search retain their own rows.

Recalculate from the repository root (Python standard library only):

```sh
python3 - <<'PY'
import json
from pathlib import Path
from statistics import median
p = Path('crates/perf/evidence/r23-host-40170055163')
reports = {}
for i in range(1, 4):
    for ref in ('historical', 'candidate'):
        d = json.loads((p / f'{ref}-{i}.json').read_text())
        assert d['runs'] == len(d['loads']) == 11 and not d['skipped']
        assert all(len(v) == 11 for v in d['per_run'].values())
        assert median(d['loads']) / d['cpus'] <= 2.0
        reports[ref, i] = d['metrics']
for metric in ('terminal_write_p95_ms', 'write_to_output_p95_ms'):
    ceiling = median(reports['historical', i][metric] for i in range(1, 4)) * 1.10 + .001
    print(metric, 'ceiling', ceiling)
    for i in range(1, 4):
        h, c = (reports[r, i][metric] for r in ('historical', 'candidate'))
        print(i, h, c, 'ratio', c / h, 'over', c > ceiling)
PY
```

## Attribution boundary

The [profile index](profile-index.md) records perf 6.17.13 (199 Hz cpu-clock,
DWARF), 4478 historical and 5642 candidate samples, zero lost samples, overhead
controls (+8.4%/+9.5% whole-invocation wall time), strace 6.8 and all commands.
The controls/profiles are separate from all six clean timing invocations.

The retained flat reports show these self samples, **across the entire run**:

| Command/DSO/symbol | Historical | Candidate |
|---|---:|---:|
| tokio-rt-worker / compatible-perf / Parsed::deserialize | 97 | 248 |
| tokio-rt-worker / libc / malloc | 246 | 358 |
| tokio-rt-worker / kernel / finish_task_switch.isra.0 | 353 | 395 |
| terminal-11 / kernel / eventfd_write | 44 | 40 |
| terminal-11-inp / kernel / queue_work_on | 41 | below displayed 0.5% threshold |

Inspect with `gzip -dc historical-cpu-flat.stdout.gz` and the candidate
counterpart; the `*-cpu-report.stdout.gz` files retain caller trees.
`Parsed::deserialize` demonstrates probe-side JSON work, not its attribution to
one metric. The PTY-thread samples show wake/queue activity, not per-write
latency. Kernel scheduler samples measure on-CPU switch/wake work, not time
spent asleep. They must not be converted to percentages of end-to-end p95.

The syscall summaries aggregate all traced descendants and setup/teardown.
Historical/candidate `futex` wall seconds are 28.791798/53.153048; `read` is
57.327516/57.615782 and `epoll_wait` 5.178384/6.554291. These overlap across
threads and include idle login shells. They cannot establish that candidate
write requests spend the difference waiting on a lock or reactor.

The candidate source path includes `connection::handle` and
`Daemon::dispatch_parsed`, the Terminal input worker/PTY, `output::forward` and
the connection socket writer, then Client decoding and `wait_for_output`.
The recordings include this workload, but the displayed trees lack phase
markers joining those boundaries to individual write requests. Setup, Rail,
ping and both write loops share the profile. The ephemeral DSOs were not
retained; further raw symbolization requires matching their recorded build ids
and hashes, not merely rebuilding the source and assuming identity.

Therefore neither a dominant write-stage CPU function nor a scheduling wait
explains a measured Daemon difference yet. [Investigation #3971](https://github.com/roundup-app/roundup/issues/3971)
blocks #3760 to isolate adapter cost and request/reply, PTY and delivery stages.
It is linked under [#3720](https://github.com/roundup-app/roundup/issues/3720).
This is an incomplete attribution verdict, with both compatible-observer write
metrics fitting their R23 ceilings. No repair, calibration, full R16 pass,
baseline increase or relaxation of R16 step 3 is claimed.
