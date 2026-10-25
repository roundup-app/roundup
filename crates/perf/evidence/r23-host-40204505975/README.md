# R23 execution qualification attempt: 40204505975

The unchanged exact-9V45 preflight exited **2** on `AMD EPYC 7763 64-Core Processor`.
Ubuntu 24.04 x86_64, four available CPUs, online set and affinity `0-3` match;
the exact CPU does not. No build, producer/dispatch collection or control ran.
This host report does not complete #4032 or #4031. #3760 remains open under #3720.

| Command record | Result | Actual exit |
|---|---|---:|
| `qualification.command` | CPU mismatch; shell bytes reused unchanged from `../r23-host-40196101407/qualification.command` | 2 |
| `runner-inventory.command` | Repository runner inventory denied, HTTP 403 | 1 |
| `launch-inputs.command` | Existing Builder inputs expose no exact CPU selector | 0 |
| `active-jobs.command` | Runner/job identities and labels, without exact CPU or remote execution endpoint | 0 |
| `previous-lifetime.command` | Qualified #4032 job 121189514795 ended with failure; no continuing collection | 0 |
| `machine.command` | OS, CPU/count/affinity, toolchain, shell, load and background processes | 0 |
| `boot-before.command`, `boot-after.command` | Identical boot IDs | 0 each |

Every command retains original stdout, stderr and actual exit status beside its
command file. `metadata.json` records selected runner/job and build environment
fields without credentials. No pinned binaries or build settings are claimed.
Inventory denial and available job metadata identify no accessible qualified
target; they do not prove none exists. No loop machinery change or substitution
is proposed. No user or Mac decision is required.

## Remaining execution

Reuse the retained six clean timing observations in `../r23-host-40170055163/`,
probe isolation in `../r23-spans-40175332310/`, original identities/executable
material in `../r23-queues-40186616032/`, and assessment in
`../r23-assessment-40190149199/`. Collect no replacement timing campaign.
The qualified attempt `../r23-producer-40200071512/` retained only setup:
completed builds, captures and controls are absent and cannot count as evidence.

On an exact-qualified new lifetime, #4032 still requires identically built
historical `2029ed2c4ee606d26e73c858c4d7c93130df36e0` and candidate
`50e546c1a3ce74689738b08a3dfe273895f9ae31`, original executable material,
supported producer/source/symbol attempts and initial-dispatch/submission
observations. Use historical `Terminals::write`, candidate `Terminals::enqueue`
and both `pump` functions in `crates/terminal/src/lib.rs`; `pty.rs` is absent at
both pins. Keep failed attempts, statuses and original write/task/thread/FD
identities. Finish builds, compression and offline processing before repeated
alternating unmodified/instrumented controls with both unchanged probes.
Retain capture, controls and offline assessment together before that host ends.

Producer enqueue/publication, initial dispatch, executor enqueue/full task polls
and inseparable observer overhead remain unresolved; this miss supplies no new
bound. A selected-future poll is not a runtime task poll, and thread CPU includes
observer execution. Never subtract diagnostic intervals from clean p95s, add
overlapping branches, equate acceptance with physical completion or charge earlier
pending-read idle time to a write. #4032 already owns this prerequisite for #4031
under #3760 and #3720; no duplicate work Issue is needed.

Existing comparisons remain separate: `terminal_write_p95_ms` fits its
historical-derived ceiling in all three candidate invocations;
`write_to_output_p95_ms` also fits its ceiling in all three. Neither comparison
attributes the cause. R8 pins, R13 load qualification, R15 pacing, R16 ceilings
and rule 7 limits are unchanged. No clean R16 verdict, calibration, baseline
increase or production repair is supplied.
