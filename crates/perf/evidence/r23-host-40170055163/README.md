# R23 qualified execution lifetime: Builder 40170055163

The existing [Builder job](https://github.com/roundup-app/roundup/actions/runs/40170055163/job/121099181922)
passes the unchanged exact-model preflight (exit 0): AMD EPYC 9V45 96-Core
Processor, Ubuntu 24.04, x86_64, four online/available CPUs, affinity 0-3.
Runner `GitHub Actions 1000008770`, boot id
`e9fdfeed-a2c3-47bd-a462-17a0bf2fe2fc`, identifies this lifetime. No resource
was created. Existing-host search found this run qualified, so no other host
or CPU class was substituted. Runner inventory is inaccessible (HTTP 403);
that denial does not imply no other qualified hardware exists.

All six alternating eleven-Daemon observations and both separate reference
profiles completed before this lifetime ended. The same compatible probe bytes
ran against both unmodified references. This delivers #3764's execution
prerequisite; #3760 owns compatibility assessment, paired conclusions and
attribution, with remaining investigation/repair under #3720. No calibration,
R16 pass, performance repair or full perf pass is claimed.

| Evidence | Contents |
|---|---|
| [machine.txt](machine.txt), [qualification.txt](qualification.txt) | Full R16 identity, toolchain, shell, checkout, runner and preflight command/output/status |
| [host-search.txt](host-search.txt), [build-settings.txt](build-settings.txt) | Existing facility search, Actions job identity, clean reference checkouts, lock hashes and release settings |
| [binaries.sha256](binaries.sha256), [compatibility.patch](compatibility.patch) | Unmodified reference executables and identical scratch probe; compatibility diff |
| [timing-index.md](timing-index.md) | Six invocations, all eleven samples per report, load qualification, raw commands/stdout/stderr/statuses and ceiling misses |
| [profile-index.md](profile-index.md) | Both raw CPU recordings, resolved stacks, separate syscall profiles and unprofiled overhead controls |
| [reproduce.txt](reproduce.txt), [collect.py.txt](collect.py.txt), [profile.py.txt](profile.py.txt) | Exact build and same-lifetime collection/reproduction commands |
| [lifetime-end.txt](lifetime-end.txt) | Same boot id, exact model/affinity and unchanged binary hashes after all observations |

References: historical `2029ed2c4ee606d26e73c858c4d7c93130df36e0`, candidate
`50e546c1a3ce74689738b08a3dfe273895f9ae31`. Both use rustc 1.99.0 and Cargo's
unmodified default release profile, with the same environment and no RUSTFLAGS,
wrapper or target override. Both original builds exit 0; their `.log.gz` and `.exit`
records are retained. The scratch probe builds only after their executables are
copied and hashed, so patched Client code never enters either measured Daemon.
H15's post-write hook loop is excluded for both references; see the timing index.

Every unsuccessful attempt remains below. Each timing/profile basename has its
own command, stdout/stderr and actual status. Diagnostic scratch ceilings permit
collection without changing committed budgets, baseline provenance, noise or
absolute limits; a diagnostic miss is not a same-class regression conclusion.

| Command/reference | Result | Exit |
|---|---|---|
| `gh api repos/roundup-app/roundup/actions/runners` (`host-search.txt`) | HTTP 403, inventory unavailable | 1 |
| [Original candidate probe / historical Daemon](candidate-probe-historical-daemon.command) | `rail.createWorkstream` missing; observer failure, no timing report | 2 |
| [Original historical probe / candidate Daemon](historical-probe-candidate-daemon.command) | `rail.createGroup` missing; observer failure, no timing report | 2 |
| `CARGO_TARGET_DIR=/tmp/r23-candidate-target cargo build --release -p perf --bin perf`, cwd `/tmp/r23-probe`, first patch | Unused hook constant/function after excluding H15; see `compatible-build-attempt-1.patch` and `.log.gz` | 101 |
| [historical-1](historical-1.command) | Diagnostic ceiling misses retained in stdout/JSON | 1 |
| [candidate-1](candidate-1.command) | Diagnostic ceiling misses retained in stdout/JSON | 1 |
| [historical-2](historical-2.command) | Diagnostic ceiling misses retained in stdout/JSON | 1 |
| [candidate-2](candidate-2.command) | Diagnostic ceiling misses retained in stdout/JSON | 1 |
| [historical-3](historical-3.command) | Diagnostic ceiling misses retained in stdout/JSON | 1 |
| [candidate-3](candidate-3.command) | Diagnostic ceiling misses retained in stdout/JSON | 1 |
| [Historical control](historical-profile-control.command) | Diagnostic ceiling misses, separate 50000-call control | 1 |
| [Historical CPU profile](historical-profile.command) | Diagnostic ceiling misses, complete raw profile retained | 1 |
| [Historical syscall profile](historical-syscalls.command) | Diagnostic ceiling misses, complete summary retained | 1 |
| [Candidate control](candidate-profile-control.command) | Diagnostic ceiling misses, separate 50000-call control | 1 |
| [Candidate CPU profile](candidate-profile.command) | Diagnostic ceiling misses, complete raw profile retained | 1 |
| [Candidate syscall profile](candidate-syscalls.command) | Diagnostic ceiling misses, complete summary retained | 1 |

The final scratch build exits 0; its function reference keeps the excluded H15
helper compiled without executing it. No lint suppression or production change
is needed. Profiler recording/extraction/compression commands exit 0. Full CPU
call-stack stdout is gzip-compressed to preserve generated output without a large
text diff; the corresponding `.command`, `.stderr` and `.exit` remain plain text.
Raw build logs and flat profiler output are also gzip-compressed: upstream
package/symbol spellings remain exact without adding spelling exceptions.
No Mac observation or user decision is required.
