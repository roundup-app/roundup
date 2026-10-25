# R23 correlated write diagnostics (#3976)

Pinned historical `2029ed2c4ee606d26e73c858c4d7c93130df36e0` and candidate
`50e546c1a3ce74689738b08a3dfe273895f9ae31`; Builder 40175332310.
`qualification.command` exits 0 on this exact R16 9V45 host. `machine.stdout`
and `lifetime.json` retain the OS, CPU, online/available CPUs, affinity, boot
identity, runner, toolchain, shell and observer versions. No host was allocated.

The six original clean observations in `../r23-host-40170055163/` remain the
comparison evidence. `input-hashes.json` pins them. The offline extraction in
[PR #3975](https://github.com/roundup-app/roundup/pull/3975),
`r23-attribution-40174335770`, establishes the earlier recordings' limits;
this collection adds per-loop/per-write and scheduler records without repeating
its whole-invocation CPU-table analysis.

`common-probe.patch` reproduces the prior compatibility changes on a scratch
candidate checkout. `marked-probe.patch` additionally brackets the existing
probe operations. Both run against each identical, unmodified Daemon executable.
`final-hashes.stdout` retains executable SHA-256 hashes and GNU build IDs;
`build-settings.json` pins the shared toolchain and unchanged release settings.
The production checkout contains evidence only. No synthetic timing test,
production repair, budget, baseline, contract or App change is made.
