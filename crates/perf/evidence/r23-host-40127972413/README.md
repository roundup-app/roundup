# R23 host attempt: 40127972413

Result: qualification failed. #3764 remains open and #3760 remains blocked by it;
remaining measurement/repair work belongs under #3720.

| Evidence | Result |
|---|---|
| [machine.txt](machine.txt) | Full host-inspection commands, outputs and statuses; Ubuntu 24.04, x86_64, four available CPUs, online/allowed `0-3`, exact model `AMD EPYC 7763 64-Core Processor` |
| [qualification.txt](qualification.txt) | Reproducible standalone identity preflight; exit 2 because R23 requires `AMD EPYC 9V45 96-Core Processor` |
| [host-search.txt](host-search.txt) | Existing PR evidence and Actions job search; no reachable qualified execution host identified |

Checkout: `f82fd7499a07f81a8dd42947b2b9d3c353c15905`.
Execution: [Actions run 40127972413](https://github.com/saadshahd/roundup/actions/runs/40127972413),
job `120973603580` (`build #3764 / build`), runner `GitHub Actions 1000193095`.
The boot id in `machine.txt` identifies this VM lifetime. No Daemon/probe build,
timing invocation or diagnostic profile was attempted. There are no executable
hashes or release measurement settings to report for this attempt.

| Failed command (full text/output in linked evidence) | Reference | Failure | Actual exit |
|---|---|---|---|
| Identity preflight in `qualification.txt` | Checkout above | Exact CPU model mismatch: 7763, requires 9V45 | 2 |
| `gh api repos/saadshahd/roundup/actions/runners` | Existing-host search | HTTP 403: resource not accessible by integration | 1 |
| `gh api repos/saadshahd/roundup/actions/jobs/120973032241/logs` | Active job in run 40127768370 | HTTP 404: BlobNotFound; no host identity obtained | 1 |

These are preflight/search statuses, not perf observer results. Historical 9V45
reports in `../linux-9v45/` predate R23's candidate and provide no reusable host
endpoint. Job metadata lists runner names/labels, not exact CPU models or an
execution channel. Runner inventory access was denied, so this search cannot
claim that no 9V45 hardware exists.

No resource was created: the existing Builder workflow has no exact CPU-model
input, and another #3764 build waits behind this job's concurrency group. No
reachable qualified host lifetime was supplied. See `docs/perf.md`, heading
“R23 execution lifetime (#3764)”, for the next attempt and same-lifetime collection
requirements. #3760 retains ownership of compatibility, timing and attribution.
