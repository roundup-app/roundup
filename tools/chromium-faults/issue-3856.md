# U26 bpftrace compatibility

Runner: Ubuntu 26.04.1 LTS (Resolute), x86_64,
Linux 7.0.0-1017-azure, bpftrace v0.25.0 (Ubuntu 0.25.0-1ubuntu1),
LLVM 21.1.8. Baseline: `a284e11af9d48e9fad4f83fba29bfc757019e3e3`.

The unchanged tracer aborts before attachment:

```text
bpftrace: ./src/ast/irbuilderbpf.cpp:248:
llvm::AllocaInst* bpftrace::ast::IRBuilderBPF::CreateAllocaBPF(llvm::Type*, const std::string&):
Assertion `module_.getDataLayout().getTypeAllocSize(ty) <= 256' failed.
```

| Baseline command | Result | Exit |
| --- | --- | --- |
| `python3 loop/app-data.py python3 tools/chromium-faults/test.py` | 11 tests, 6 failures and 1 error; 114.952 s | 1 |
| `python3 loop/app-data.py python3 tools/chromium-faults/cold.test.py` | 4 tests, 1 failure (observer never attached); 124.986 s | 1 |

Initial setup attempts also exited 1: fault tests lacked libfuse3 development
files (7 errors), and cold tests lacked the worktree's pnpm dependencies
(4 errors). Installed the dependencies before the baseline above. Ubuntu's
fusermount3 AppArmor profile also denied fixture cleanup capabilities; the
runner's local profile grants `dac_override` and `setuid` for subsequent runs.
No repository checks or assertions were changed for setup.

The direct compiler invocation also exits 134 (SIGABRT). The repair keeps
`str()` at its installed default length: the sentinel reads the tracer's task
name into the same string type as a basename, avoiding the compiler's widening
of an empty string literal inside the tuple. Sentinel key 0 is still ignored
as a fault and still required in every accepted snapshot.

Membership probes use bpftrace's `has_key`; the completion counter is initialized.
Expected absence therefore creates no failing map lookup under `-k`. Every
required deletion checks `delete`'s return and marks kernel integrity invalid
on failure. The fault identities, stack capture, map lifetime, sampling bounds,
attachment gate and snapshot envelopes remain kernel-owned.

GNU timeout's installed `--foreground --preserve-status` options deliver one
shutdown signal and preserve bpftrace's own status. The 15-minute watchdog and
five-second forced-stop bound remain. Without these options, shutdown reproduced
exit 137 with no final snapshot; foreground alone produced a final snapshot but
returned supervisor status 124.

bpftrace 0.25 emits both structured loss events and a final stderr total
([upstream shutdown](https://github.com/bpftrace/bpftrace/blob/v0.25.0/src/bpftrace.cpp)).
The observer retains both as errors, marks history incomplete, and requires the
summary to equal the structured count. Only independent intact final kernel maps
can verify live state. A mismatched total or any other warning still invalidates
live evidence. Two negative probes using the existing stream-ordering fixture
confirmed this: summary 1 against structured count 0, and an unrelated WARNING,
both gave `history_complete=false`, `live_state_verified=false`, command exit 0.
These parser probes supplement the real kernel tests; none replaces one.

The file fixture uses `RUNNER_TEMP` (the runner's ext4 disk), falling back to its
source directory outside Actions. The loss-inducing burst now evicts real disk
pages even when `/tmp` is tmpfs. All existing assertions and test cases remain;
none repeats another case's combination of lifecycle, stream ordering, tracer
death, reporting failure, signal preservation or stdout-backpressure timing.

| Full-suite repair attempt | Fault result (exit) | Cold result (exit) |
| --- | --- | --- |
| Typed sentinel, membership and deletion checks | 4 failures, 69.515 s (1) | 1 failure, 156.432 s (1) |
| Foreground shutdown only | 2 failures, 75.853 s (1) | 1 failure, 147.324 s (1) |
| Preserved status and reconciled loss count; fixture still on tmpfs | 1 failure, 42.909 s (1) | — |

The first attempt lacked graceful final evidence; its final-reporting backpressure
case also missed completion. Foreground alone still invalidated evidence on status
124; that run's final-reporting case observed the outside reader runnable at its
instantaneous disk-sleep assertion. The tmpfs attempt correctly retained complete
history because it could not induce real disk loss. None of these failures was
removed or accepted as success.

| Targeted consumer probe | Result | Exit |
| --- | --- | --- |
| Before foreground | Unverified final state; 5.881 s | 1 |
| Foreground, tmpfs | Supervisor 124; 13.593 s | 1 |
| Foreground, disk via TMPDIR | Loss observed; summary warning and status 124 invalidated live state; 25.308 s | 1 |
| Preserve status, tmpfs | History correctly complete; no loss induced; 5.922 s | 1 |
| Source-directory fixture in this tmpfs worktree | No loss induced; 6.405 s | 1 |

Final fault command: `python3 loop/app-data.py python3 tools/chromium-faults/test.py`:
11 tests, **OK**, 31.370 s, exit **0**. This includes real held faults, consumer
loss with identity recovery, final snapshots, tracer death and all three stdout
backpressure positions. `just lint-web` and `just lint-rust`: exit **0**.

No product behavior or App surface changes; no Principle gate or design Check
moves. U26's observers are the existing kernel fault and isolated Chromium tests.

Final cold command: `python3 loop/app-data.py python3 tools/chromium-faults/cold.test.py`:
4 tests, **OK**, 126.943 s, exit **0**. The held pair rejected at 60006.477 ms
and 60008.340 ms before release with verified fault evidence; independent warmup
was still pending at the 20044.158 ms rejection. Real concurrent and delayed-release
pairs each answered twice with 42 and closed their owned browsers. Existing
readiness, attachment, stage and cleanup assertions all passed.
