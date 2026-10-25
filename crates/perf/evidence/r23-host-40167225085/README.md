# R23 host attempt: 40167225085

Qualification failed: exact model `AMD EPYC 7763 64-Core Processor`;
R23 requires `AMD EPYC 9V45 96-Core Processor`. Ubuntu 24.04, x86_64,
four online/available CPUs and unrestricted `0-3` affinity match.
#3764 remains open; #3760 remains blocked by it, with measurement/repair work
under #3720. No timing invocation or diagnostic profile was collected.

| Evidence | Contents |
|---|---|
| [machine.txt](machine.txt) | Full identity, toolchain, shell, source checkout, runner and boot id; commands and actual statuses |
| [qualification.txt](qualification.txt) | Unchanged previous standalone preflight; exact-model mismatch, exit 2 |
| [host-search.txt](host-search.txt) | Existing evidence/PR search, active Builder jobs, runner inventory, log requests, dependency and execution-facility inspection |

Inspection checkout: `20cd2082a4e4164fafcfa800721fe242e29ee299`.
[Actions run 40167225085, job 121091155240](https://github.com/roundup-app/roundup/actions/runs/40167225085/job/121091155240),
runner `GitHub Actions 1000007877`, boot id
`087406be-3b2e-4525-ac74-ce5854e679be` identify this lifetime.

| Failed command | Result | Exit |
|---|---|---|
| Standalone preflight in `qualification.txt` | Exact CPU mismatch | 2 |
| `gh api repos/roundup-app/roundup/actions/runners` | HTTP 403; inventory inaccessible | 1 |
| `gh api repos/roundup-app/roundup/actions/jobs/121091437568/logs` | Active Builder; HTTP 404, BlobNotFound | 1 |
| `gh api repos/roundup-app/roundup/actions/jobs/121091155297/logs` | Active Builder; HTTP 404, BlobNotFound | 1 |
| `gh api repos/roundup-app/roundup/actions/jobs/121089226424/logs` | Active Builder; HTTP 404, BlobNotFound | 1 |
| `gh api repos/roundup-app/roundup/actions/jobs/121089226507/logs` | Active Builder; HTTP 404, BlobNotFound | 1 |
| `gh api repos/roundup-app/roundup/actions/jobs/121088202873/logs` | Active Builder; HTTP 404, BlobNotFound | 1 |
| `gh api repos/roundup-app/roundup/actions/jobs/121083152145/logs` | Active Builder; HTTP 404, BlobNotFound | 1 |
| `gh api repos/roundup-app/roundup/actions/jobs/121079721981/logs` | Active Builder; HTTP 404, BlobNotFound | 1 |

No reachable qualified host was identified. Historical 9V45 reports predate R23's
candidate and expose no live command endpoint; active-job metadata establishes
neither CPU identity nor remote execution access. Inventory denial does not prove
that no qualifying hardware exists. The existing Builder facility selects
`ubuntu-24.04`, exposes no exact-model input and serializes builds of this Issue.
No resource was created and no workflow or machine-class selection was changed.

These are inspection/preflight statuses, not perf observer results. No measurement
release build was attempted, so no measurement executable hashes or release
settings are claimed. Validation binaries supply no R23 observation or calibration.
The same-lifetime reproduction instructions in `docs/perf.md`, heading
“R23 execution lifetime (#3764)”, require a qualified host to retain all six timing
invocations and both profiles before expiry. #3760 retains probe compatibility,
paired measurements, attribution and conclusions. No Mac or product decision is
needed; acceptance remains incomplete.
