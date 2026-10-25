# R23 execution qualification attempt: 40206540231

The unchanged exact-9V45 preflight exited **2** on `AMD EPYC 7763 64-Core Processor`.
Ubuntu 24.04 x86_64, four available CPUs, online set and affinity `0-3` match;
the exact CPU does not. No build, producer/dispatch collection or control ran.
#4032 and #4031 remain incomplete; #3760 stays open under #3720.

| Command record | Result | Actual exit |
|---|---|---:|
| `qualification.command` | Exact CPU mismatch; qualification shell reused unchanged from `../r23-host-40204505975/qualification.command` | 2 |
| `runner-inventory.command` | Repository runner inventory denied, HTTP 403 | 1 |
| `launch-inputs.command` | Existing launch inputs expose no exact CPU selector | 0 |
| `active-jobs.command` | Current runner/job identity and labels; no qualified remote execution endpoint | 0 |
| `previous-lifetime.command` | Qualified job 121189514795 ended with failure at 2026-10-25T14:24:52Z | 0 |
| `machine.command` | OS, CPU/count/affinity, toolchain, shell, load and background processes | 0 |
| `settings.command` | Shell, build environment overrides and installed profiler versions; no build performed | 0 |
| `boot-before.command`, `boot-after.command` | Identical boot IDs | 0 each |

Each command retains original stdout, stderr and actual status. `metadata.json`
records selected runner/job environment fields and the checkout without credentials.
Inventory denial and job metadata identify no accessible qualified target; they do
not establish that none exists. No loop machinery change or CPU substitution is
proposed. No user or Mac decision is required.

The [previous continuation](../r23-host-40204505975/README.md#remaining-execution)
states the remaining execution and per-metric conclusions. Reuse the six clean
pairs, probe isolation, original identities/executables and assessment linked there.
The [qualified lifetime](../r23-producer-40200071512/README.md) retained setup only;
its Issue comment's capture/control claims have no retained material to assess.

```text
exact 9V45 qualification → builds and producer/dispatch attempts → offline processing
→ repeated alternating isolated controls → capture and assessment retained together
```

This attempt stopped at qualification. Producer enqueue/publication, initial
dispatch/scheduling, exact executor enqueue/full task polls and observer overhead
remain unresolved. #4032 already owns the missing execution prerequisite of #4031;
no duplicate Issue is needed. A selected-future poll is not a full runtime task poll,
and thread CPU includes observer execution. No new overhead bound or attribution
is supplied.

`terminal_write_p95_ms` fits its historical-derived ceiling in all three retained
candidate invocations. Separately, `write_to_output_p95_ms` fits its ceiling in all
three. Neither establishes Daemon-only attribution. Never subtract diagnostic
intervals from clean p95s, sum overlapping branches, equate acceptance with physical
completion or charge a pending read's earlier idle time to a write. R8 pins, R13
load qualification, R15 pacing, R16 ceilings and rule 7 limits remain unchanged.
This report supplies no clean R16 verdict, calibration, baseline increase or
production repair and does not complete #4032.
