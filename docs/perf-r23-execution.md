# R23 execution lifetime (#3764)

Earlier attempts left [#3764](https://github.com/saadshahd/roundup/issues/3764) open: Builder
[40127972413](https://github.com/saadshahd/roundup/actions/runs/40127972413)
at `f82fd7499a07f81a8dd42947b2b9d3c353c15905` has exact model
`AMD EPYC 7763 64-Core Processor`, so its R23 host preflight exits 2.
The commands, full identity, statuses and existing-host search are retained in
[`r23-host-40127972413`](../crates/perf/evidence/r23-host-40127972413/README.md).
No R23 timing or profile was collected. The [earlier 9V45 diagnosis](perf.md#builder-9v45-diagnosis-3700-r16-steps-1-to-3) predates
R23's candidate and supplies neither a live host nor an R23 observation.

Builder [40131015578](https://github.com/saadshahd/roundup/actions/runs/40131015578)
also failed the exact-model preflight (exit 2): its model is
`Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz`. Ubuntu 24.04, x86_64,
four online/available CPUs and affinity `0-3` match, but do not qualify that CPU.
[Full identity and existing-host search](../crates/perf/evidence/r23-host-40131015578/README.md)
retain the commands and statuses. No reachable qualified lifetime was identified;
runner inventory returned HTTP 403 and active sibling logs HTTP 404. No resource,
R23 timing or profile was produced. #3764 remains open and #3760 stays blocked;
remaining measurement/repair work stays under #3720.

Builder [40133799182](https://github.com/saadshahd/roundup/actions/runs/40133799182)
again reports `AMD EPYC 7763 64-Core Processor`; the unchanged standalone preflight
exits 2. [Identity and search evidence](../crates/perf/evidence/r23-host-40133799182/README.md)
retain the boot identity, commands and statuses. Runner inventory returned HTTP
403 and two active Builder log requests returned HTTP 404; no reachable qualified
lifetime was identified. No resource, timing invocation or profile was produced.
#3764 remains open and #3760 blocked, with remaining work under #3720.

Builder [40167225085](https://github.com/roundup-app/roundup/actions/runs/40167225085)
also fails the unchanged preflight (exit 2): `AMD EPYC 7763 64-Core Processor`.
[Identity and existing-host search](../crates/perf/evidence/r23-host-40167225085/README.md)
retain the commands, boot id and statuses. Inventory returned HTTP 403 and seven
active Builder log requests returned HTTP 404; no reachable qualified lifetime
was identified. No resource, timing or profile was produced. #3764 stays open,
#3760 blocked, and remaining measurement/repair work stays under #3720.

Builder [40170055163](https://github.com/roundup-app/roundup/actions/runs/40170055163/job/121099181922)
qualifies on exact `AMD EPYC 9V45 96-Core Processor`: Ubuntu 24.04, x86_64,
four online/available CPUs and affinity `0-3`; standalone preflight exits 0.
[Retained evidence](../crates/perf/evidence/r23-host-40170055163/README.md)
identifies the runner and boot lifetime. It collects all six alternating
historical/candidate eleven-Daemon invocations and both separate CPU/syscall
profiles within that lifetime, using one compatible probe binary. The
[timing index](../crates/perf/evidence/r23-host-40170055163/timing-index.md)
retains the invocation medians, loads and statuses. No timing invocation skips
a write comparison or exceeds the median load threshold. Exit 1 reports retain
all misses against explicitly diagnostic scratch ceilings; no calibration or
full perf pass is claimed. H15 runs after the measured writes and is omitted
for both references; this does not supply an H15 observation.

The [reproduction commands](../crates/perf/evidence/r23-host-40170055163/reproduce.txt),
compatibility patch, executable hashes, raw compressed profiles and profiler
controls let #3760 consume these observations after the host expires. This
satisfies #3764's execution-lifetime collection, leaving #3760's compatibility
assessment, attribution and per-metric conclusions under #3720. No resource,
production source, baseline, machine selection or loop change was needed.

For a fresh execution attempt, use the existing Builder facility:

1. Search existing host evidence and active Actions jobs before allocating a host.
   A job name or `ubuntu-latest` label does not establish CPU identity or access.
   Runner inventory requests returned HTTP 403; job metadata exposed
   no remote execution endpoint. The existing `build-issue.yml` selects
   `ubuntu-24.04` without an exact CPU selector and serializes builds of one Issue.
   Dispatching another build during this one would not hand off its lifetime.
2. On the execution host, retain the [full identity commands](perf.md#linux-builder-classes-r16-specification) and execute the
   [qualification preflight](../crates/perf/evidence/r23-host-40170055163/qualification.txt). Require exit 0 and retain the Actions run/job,
   runner name and `/proc/sys/kernel/random/boot_id` to identify the lifetime.
   Exit 2 means stop before timing; never substitute another CPU class.
3. Keep that host alive through #3760's observations. Build historical
   `2029ed2c4ee606d26e73c858c4d7c93130df36e0` and candidate
   `50e546c1a3ce74689738b08a3dfe273895f9ae31` there with the same toolchain and
   release settings (`cargo build --release -p rupd -p rup -p perf`). Retain
   executable SHA-256 hashes and #3760's compatibility diff before measuring.
4. Execute #3760's compatible probe commands in order historical-1, candidate-1,
   historical-2, candidate-2, historical-3, candidate-3, eleven fresh Daemons each.
   Retain reports, logs, statuses, failed attempts and busy-pair repeats. Collect
   both diagnostic profiles separately from these timing invocations. Keep all
   evidence under `crates/perf/evidence/` and link it on #3760 before the job ends.
   If another run cannot execute on this same live host, the qualifying run must
   collect these observations itself; an identity-only handoff is incomplete.

R23 in [scenarios/perf.md](../scenarios/perf.md) governs workloads, load qualification, ceilings and
attribution. #3760 owns probe compatibility and per-metric conclusions; remaining
measurement and repair work stays linked to #3720. Qualification and diagnostic
collection establish no calibration or performance pass.

