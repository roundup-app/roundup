# Capture controls and actual statuses

Each row is one diagnostic invocation with one fresh Daemon, ten login shells,
100 warmups and 1000 paced writes per loop. The two write loops total 2200
requests and echo bytes. These runs supply no clean timing pair or calibration.
All workload reports exit 1 against the unchanged retained diagnostic scratch
ceilings; their stdout names every miss. All skipped lists are empty.

Wall seconds include startup, cleanup and recorder drain, including the same
20 ms /proc association sampler. They are observer overhead controls, not a
per-write correction or a measurement of a dominant cause. Retention compression
of the large V2 attempt overlapped some V3 diagnostics; that background cost
also prevents treating these controls as an isolated overhead bound. Existing metric
values remain in each raw report; no new stage percentiles or CPU table is made.

| Invocation / command | Wall s | Loads / CPUs | Exit |
|---|---:|---|---:|
| [candidate-instrumented-v3-common-control](candidate-instrumented-v3-common-control.command) | 2.0050 | [1.56] / 4 | 1 |
| [candidate-instrumented-v3-common-kernel](candidate-instrumented-v3-common-kernel.command) | 4.3127 | [2.64] / 4 | 1 |
| [candidate-instrumented-v3-common-low](candidate-instrumented-v3-common-low.command) | 4.2744 | [3.62] / 4 | 1 |
| [candidate-instrumented-v3-marked-control](candidate-instrumented-v3-marked-control.command) | 2.2439 | [2.49] / 4 | 1 |
| [candidate-instrumented-v3-marked-kernel](candidate-instrumented-v3-marked-kernel.command) | 5.1795 | [2.45] / 4 | 1 |
| [candidate-instrumented-v3-marked-low](candidate-instrumented-v3-marked-low.command) | 4.3086 | [3.14] / 4 | 1 |
| [candidate-instrumented-v3-marked-sched](candidate-instrumented-v3-marked-sched.command) | 3.4027 | [2.7] / 4 | 1 |
| [candidate-unmodified-common-control](candidate-unmodified-common-control.command) | 1.7428 | [2.02] / 4 | 1 |
| [candidate-unmodified-common-kernel](candidate-unmodified-common-kernel.command) | 4.2679 | [2.02] / 4 | 1 |
| [candidate-unmodified-common-low](candidate-unmodified-common-low.command) | 4.3415 | [2.75] / 4 | 1 |
| [candidate-unmodified-marked-control](candidate-unmodified-marked-control.command) | 1.8093 | [1.87] / 4 | 1 |
| [candidate-unmodified-marked-kernel](candidate-unmodified-marked-kernel.command) | 4.2916 | [1.72] / 4 | 1 |
| [candidate-unmodified-marked-low](candidate-unmodified-marked-low.command) | 4.3161 | [2.61] / 4 | 1 |
| [historical-instrumented-common-control](historical-instrumented-common-control.command) | 9.2496 | [2.17] / 4 | 1 |
| [historical-instrumented-common-kernel](historical-instrumented-common-kernel.command) | 29.3435 | [1.99] / 4 | 1 |
| [historical-instrumented-v2-marked-control](historical-instrumented-v2-marked-control.command) | 9.3691 | [2.88] / 4 | 1 |
| [historical-instrumented-v3-common-control](historical-instrumented-v3-common-control.command) | 1.8457 | [2.98] / 4 | 1 |
| [historical-instrumented-v3-common-kernel](historical-instrumented-v3-common-kernel.command) | 4.8867 | [2.98] / 4 | 1 |
| [historical-instrumented-v3-common-low](historical-instrumented-v3-common-low.command) | 5.0976 | [3.35] / 4 | 1 |
| [historical-instrumented-v3-marked-control](historical-instrumented-v3-marked-control.command) | 1.8378 | [2.6] / 4 | 1 |
| [historical-instrumented-v3-marked-kernel](historical-instrumented-v3-marked-kernel.command) | 4.3300 | [2.56] / 4 | 1 |
| [historical-instrumented-v3-marked-low](historical-instrumented-v3-marked-low.command) | 4.2821 | [2.99] / 4 | 1 |
| [historical-instrumented-v3-marked-sched](historical-instrumented-v3-marked-sched.command) | 3.3971 | [2.11] / 4 | 1 |
| [historical-unmodified-common-control](historical-unmodified-common-control.command) | 1.5839 | [4.66] / 4 | 1 |
| [historical-unmodified-common-kernel](historical-unmodified-common-kernel.command) | 4.2317 | [4.66] / 4 | 1 |
| [historical-unmodified-common-low](historical-unmodified-common-low.command) | 4.1357 | [3.27] / 4 | 1 |
| [historical-unmodified-marked-control](historical-unmodified-marked-control.command) | 1.6001 | [2.64] / 4 | 1 |
| [historical-unmodified-marked-kernel](historical-unmodified-marked-kernel.command) | 4.3131 | [2.51] / 4 | 1 |
| [historical-unmodified-marked-low](historical-unmodified-marked-low.command) | 4.1609 | [3.24] / 4 | 1 |

`unmodified` is the pristine pinned Daemon; `instrumented-v3` is its retained
source patch with one-write marker logging and delegated std Wake callbacks.
Both common and marked probes run against every identical V3 and unmodified
Daemon. Historical V2 has common and marked controls too; it is retained as
the costly first attempt, not an attribution result. Candidate V2 is archived
but not observed. Probe bytes are reused unchanged from #3982.

`control` has no kernel recorder; `sched` records only scheduler events;
`kernel` records syscalls too and includes recorder feedback; `low` excludes
perf's own syscall events explicitly for every selected syscall tracepoint.
The earlier feedback and formatted-write recordings remain, with their exact
commands and bytes. No new ptrace run was made; #3982 retains those separate
perturbed endpoints. Sorting by CLOCK_MONOTONIC is necessary: out-of-order
warnings and any other recorder diagnostics remain in each stderr.

## Failures and repairs

| Command | Reference | Failure / result | Actual exit |
|---|---|---|---:|
| [candidate-build](candidate-build.command) | candidate + initial patch | Source instrumentation overlapped original build; E0716 temporary label lifetimes. Never used as unmodified control. Restored source and rebuilt cleanly. | 101 |
| [candidate-instrumented-build](candidate-instrumented-build.command) | candidate + initial patch | E0716 temporary labels across select; V2 uses owned labels. | 101 |
| [collector-attempt1](collector-attempt1.command) | historical unmodified/common | Python could not read root-owned perf.data after successful capture/extraction. Privileged streaming copy retained it. | 1 |
| [collector-attempt2](collector-attempt2.command) | historical V2/common | Explicit SIGTERM during large-file retention after extraction. Original raw file and extracted output retained with privileged copy and verified recompression. | 143 |
| [validation-final-lint-web](validation-final-lint-web.command) | evidence packaging | Split binary fragment was treated as text, causing UTF-8 decoding failure. Each part now has a gzip wrapper; original stream hashes remain identical. | 1 |
| [validation-perf-tests](validation-perf-tests.command) | main checkout | Debug rup/rupd prerequisites had not been built; N7/R20 launches failed. Built both and reran all 98 perf tests successfully. | 100 |
| [validation-lint-web](validation-lint-web.command) | evidence | Raw kernel comm spellings/hash fragments failed typos; raw text compressed without changing bytes before rerun. | 1 |

## Command index

Each link retains its exact argv/cwd, stdout/stderr (gzip when nonempty),
elapsed seconds and actual status. Empty streams remain empty files.

| Command | Exit |
|---|---:|
| [boot-after](boot-after.command) | 0 |
| [boot-before](boot-before.command) | 0 |
| [boot-final](boot-final.command) | 0 |
| [candidate-apply-instrumentation](candidate-apply-instrumentation.command) | 0 |
| [candidate-build](candidate-build.command) | 101 |
| [candidate-clean-restore](candidate-clean-restore.command) | 0 |
| [candidate-instrumented-build-v2](candidate-instrumented-build-v2.command) | 0 |
| [candidate-instrumented-build-v3](candidate-instrumented-build-v3.command) | 0 |
| [candidate-instrumented-build](candidate-instrumented-build.command) | 101 |
| [candidate-instrumented-v3-common-control](candidate-instrumented-v3-common-control.command) | 1 |
| [candidate-instrumented-v3-common-kernel-events](candidate-instrumented-v3-common-kernel-events.command) | 0 |
| [candidate-instrumented-v3-common-kernel](candidate-instrumented-v3-common-kernel.command) | 1 |
| [candidate-instrumented-v3-common-low-events](candidate-instrumented-v3-common-low-events.command) | 0 |
| [candidate-instrumented-v3-common-low](candidate-instrumented-v3-common-low.command) | 1 |
| [candidate-instrumented-v3-marked-control](candidate-instrumented-v3-marked-control.command) | 1 |
| [candidate-instrumented-v3-marked-kernel-events](candidate-instrumented-v3-marked-kernel-events.command) | 0 |
| [candidate-instrumented-v3-marked-kernel](candidate-instrumented-v3-marked-kernel.command) | 1 |
| [candidate-instrumented-v3-marked-low-events](candidate-instrumented-v3-marked-low-events.command) | 0 |
| [candidate-instrumented-v3-marked-low](candidate-instrumented-v3-marked-low.command) | 1 |
| [candidate-instrumented-v3-marked-sched-events](candidate-instrumented-v3-marked-sched-events.command) | 0 |
| [candidate-instrumented-v3-marked-sched](candidate-instrumented-v3-marked-sched.command) | 1 |
| [candidate-unmodified-build](candidate-unmodified-build.command) | 0 |
| [candidate-unmodified-common-control](candidate-unmodified-common-control.command) | 1 |
| [candidate-unmodified-common-kernel-events](candidate-unmodified-common-kernel-events.command) | 0 |
| [candidate-unmodified-common-kernel](candidate-unmodified-common-kernel.command) | 1 |
| [candidate-unmodified-common-low-events](candidate-unmodified-common-low-events.command) | 0 |
| [candidate-unmodified-common-low](candidate-unmodified-common-low.command) | 1 |
| [candidate-unmodified-marked-control](candidate-unmodified-marked-control.command) | 1 |
| [candidate-unmodified-marked-kernel-events](candidate-unmodified-marked-kernel-events.command) | 0 |
| [candidate-unmodified-marked-kernel](candidate-unmodified-marked-kernel.command) | 1 |
| [candidate-unmodified-marked-low-events](candidate-unmodified-marked-low-events.command) | 0 |
| [candidate-unmodified-marked-low](candidate-unmodified-marked-low.command) | 1 |
| [capture-integrity-v2](capture-integrity-v2.command) | 0 |
| [capture-integrity](capture-integrity.command) | 0 |
| [collector-attempt1](collector-attempt1.command) | 1 |
| [collector-attempt2](collector-attempt2.command) | 143 |
| [collector-attempt3](collector-attempt3.command) | 0 |
| [collector-low](collector-low.command) | 0 |
| [exclude-perf-preflight](exclude-perf-preflight.command) | 0 |
| [hashes-after](hashes-after.command) | 0 |
| [hashes-before](hashes-before.command) | 0 |
| [hashes-final](hashes-final.command) | 0 |
| [hashes-v3-before](hashes-v3-before.command) | 0 |
| [historical-build](historical-build.command) | 0 |
| [historical-instrumented-build-v2](historical-instrumented-build-v2.command) | 0 |
| [historical-instrumented-build-v3](historical-instrumented-build-v3.command) | 0 |
| [historical-instrumented-build](historical-instrumented-build.command) | 0 |
| [historical-instrumented-common-control](historical-instrumented-common-control.command) | 1 |
| [historical-instrumented-common-kernel-events](historical-instrumented-common-kernel-events.command) | 0 |
| [historical-instrumented-common-kernel](historical-instrumented-common-kernel.command) | 1 |
| [historical-instrumented-v2-marked-control](historical-instrumented-v2-marked-control.command) | 1 |
| [historical-instrumented-v3-common-control](historical-instrumented-v3-common-control.command) | 1 |
| [historical-instrumented-v3-common-kernel-events](historical-instrumented-v3-common-kernel-events.command) | 0 |
| [historical-instrumented-v3-common-kernel](historical-instrumented-v3-common-kernel.command) | 1 |
| [historical-instrumented-v3-common-low-events](historical-instrumented-v3-common-low-events.command) | 0 |
| [historical-instrumented-v3-common-low](historical-instrumented-v3-common-low.command) | 1 |
| [historical-instrumented-v3-marked-control](historical-instrumented-v3-marked-control.command) | 1 |
| [historical-instrumented-v3-marked-kernel-events](historical-instrumented-v3-marked-kernel-events.command) | 0 |
| [historical-instrumented-v3-marked-kernel](historical-instrumented-v3-marked-kernel.command) | 1 |
| [historical-instrumented-v3-marked-low-events](historical-instrumented-v3-marked-low-events.command) | 0 |
| [historical-instrumented-v3-marked-low](historical-instrumented-v3-marked-low.command) | 1 |
| [historical-instrumented-v3-marked-sched-events](historical-instrumented-v3-marked-sched-events.command) | 0 |
| [historical-instrumented-v3-marked-sched](historical-instrumented-v3-marked-sched.command) | 1 |
| [historical-unmodified-common-control](historical-unmodified-common-control.command) | 1 |
| [historical-unmodified-common-kernel-events](historical-unmodified-common-kernel-events.command) | 0 |
| [historical-unmodified-common-kernel](historical-unmodified-common-kernel.command) | 1 |
| [historical-unmodified-common-low-events](historical-unmodified-common-low-events.command) | 0 |
| [historical-unmodified-common-low](historical-unmodified-common-low.command) | 1 |
| [historical-unmodified-marked-control](historical-unmodified-marked-control.command) | 1 |
| [historical-unmodified-marked-kernel-events](historical-unmodified-marked-kernel-events.command) | 0 |
| [historical-unmodified-marked-kernel](historical-unmodified-marked-kernel.command) | 1 |
| [historical-unmodified-marked-low-events](historical-unmodified-marked-low-events.command) | 0 |
| [historical-unmodified-marked-low](historical-unmodified-marked-low.command) | 1 |
| [installed-instrumentation](installed-instrumentation.command) | 0 |
| [jobs-after](jobs-after.command) | 0 |
| [jobs-before](jobs-before.command) | 0 |
| [jobs-final](jobs-final.command) | 0 |
| [kernel-preflight](kernel-preflight.command) | 0 |
| [machine-final](machine-final.command) | 0 |
| [machine](machine.command) | 0 |
| [offline-copy](offline-copy.command) | 0 |
| [offline-endpoints](offline-endpoints.command) | 0 |
| [offline-extract](offline-extract.command) | 0 |
| [physical-endpoints-v2](physical-endpoints-v2.command) | 0 |
| [physical-endpoints](physical-endpoints.command) | 0 |
| [qualification-after](qualification-after.command) | 0 |
| [qualification-final](qualification-final.command) | 0 |
| [qualification](qualification.command) | 0 |
| [recompress-v2-data](recompress-v2-data.command) | 0 |
| [recompress-v2-events-stdout](recompress-v2-events-stdout.command) | 0 |
| [retain-executables](retain-executables.command) | 0 |
| [retain-v2-raw](retain-v2-raw.command) | 0 |
| [reuse-bpftrace-release](reuse-bpftrace-release.command) | 0 |
| [reuse-console-release](reuse-console-release.command) | 0 |
| [reuse-tokio-release](reuse-tokio-release.command) | 0 |
| [source-identities](source-identities.command) | 0 |
| [validation-debug-prerequisites](validation-debug-prerequisites.command) | 0 |
| [validation-final-lint-rust](validation-final-lint-rust.command) | 0 |
| [validation-final-lint-web-retry](validation-final-lint-web-retry.command) | 0 |
| [validation-final-lint-web](validation-final-lint-web.command) | 1 |
| [validation-final-perf-tests](validation-final-perf-tests.command) | 0 |
| [validation-lint-rust](validation-lint-rust.command) | 0 |
| [validation-lint-web](validation-lint-web.command) | 1 |
| [validation-perf-tests-retry](validation-perf-tests-retry.command) | 0 |
| [validation-perf-tests](validation-perf-tests.command) | 100 |
| [wrapped-parts-verify](wrapped-parts-verify.command) | 0 |
