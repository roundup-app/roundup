# R23 producer-observer host attempt: 40193504693

The unchanged R23 preflight exited **2**: this Ubuntu 24.04 x86_64 runner has
`Intel(R) Xeon(R) 6973P-C`, not `AMD EPYC 9V45 96-Core Processor`.
Online CPUs, available count and affinity are `0-3`, four and `0-3`.
This attempt supplies no qualified execution lifetime for #4032 or #4031.

| Command record | Reference | Result | Actual exit |
|---|---|---|---:|
| `qualification.command` | main `d74415ac42b3783937b6d707512d1ee15948dff5`; reused `r23-queues-40186616032/qualification.command` unchanged | Exact CPU-model mismatch | 2 |
| `runner-inventory.command` | GitHub repository runner inventory | HTTP 403, resource not accessible by integration | 1 |
| `launch-inputs.command` | Same main; `build-issue.yml` | Only Issue/slug inputs; hosted Ubuntu or existing boxd route, no exact CPU-model selector | 0 |
| `machine.command` | This runner | OS, CPU/count/affinity, load/process snapshot, toolchain and shell recorded | 0 |
| `boot-before.command`, `boot-after.command` | This runner | Same boot identity before/after qualification and discovery | 0 each |

Each command has its original stdout, stderr and `.exit`. `metadata.json` retains
runner/job/run identity and selected build environment settings without credentials.
The working directory is an isolated worktree at the main reference above.
No Daemon/probe build, profile, producer/dispatch attempt, repeated control or timing
observation ran: collection requires exact host qualification first. Thus no new
executable material, profiler observation, overhead bound or assessment is claimed.
These statuses are host/discovery statuses, not perf results. Validation runs after
this capture cannot qualify the host or provide performance evidence.

## Remaining execution

#4032 remains the existing scoped execution prerequisite of #4031 under #3760 and
#3720. Runner inventory denial and the existing launch inputs identify no reachable
qualified target. A later lifetime must independently qualify; this miss cannot
be converted by affinity changes or cross-class substitution. No loop change is
proposed, and no user or Mac decision is needed.

Reuse the six clean timing reports (three pairs) from `../r23-host-40170055163/`, the common/marked probe
isolation from `../r23-spans-40175332310/`, original identities and executable
material from `../r23-queues-40186616032/`, and the bounded offline assessment from
`../r23-assessment-40190149199/`. Historical pin remains
`2029ed2c4ee606d26e73c858c4d7c93130df36e0`; candidate remains
`50e546c1a3ce74689738b08a3dfe273895f9ae31`.

On a qualified lifetime, finish identical pinned builds and retention processing
before repeated alternating controls for each identical unmodified/instrumented
Daemon and both unchanged probes. Retain producer source/symbol attempts using
each pin's actual `crates/terminal/src/lib.rs`: historical `Terminals::write`,
candidate `Terminals::enqueue`, and both `pump` functions. `pty.rs` is absent at
both pins. Attempt dispatch entry before extraction and task submission/first
selected poll; retain failures and original write/task/thread/FD identities.
Deliver capture and inseparable offline assessment together as #4032 requires.

Until then, the earlier initial-dispatch, producer enqueue/publication, exact
executor enqueue/full runtime polls and instrumentation-overhead bounds remain
unresolved. A selected-future poll is not a full runtime task poll; thread CPU
includes observer work. No diagnostic interval is subtracted from clean p95s.
The retained per-metric timing conclusions remain unchanged: both
`terminal_write_p95_ms` and `write_to_output_p95_ms` fit their historical-derived
ceilings in all three candidate invocations, without Daemon-only attribution.
R8 pins, R13 load threshold, R15 pacing, R16 ceilings and rule 7 absolute limits
remain fixed. #4032, #4031 and #3760 remain incomplete; no clean R16 verdict,
calibration, baseline increase or production repair is supplied.

## Reproduce qualification

Read the shell command after `$ ` in `qualification.command` and run it on the
new target, preserving stdout/stderr and its actual exit in a new directory.
Exit 0 qualifies identity only; exit 2 forbids collection. Repeat the machine,
boot and runner/job records for that lifetime. Do not overwrite this miss.
