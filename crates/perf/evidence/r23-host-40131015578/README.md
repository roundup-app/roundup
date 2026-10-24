# R23 host attempt: 40131015578

Qualification failed: exact model `Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz`
is not `AMD EPYC 9V45 96-Core Processor`. #3764 remains open; #3760 remains
blocked by it, with remaining measurement/repair work under #3720.

| Evidence | Result |
|---|---|
| [machine.txt](machine.txt) | Full R16 identity commands, outputs and statuses; Ubuntu 24.04, x86_64, four available CPUs, online/allowed `0-3`; Intel 8370C |
| [qualification.txt](qualification.txt) | Existing standalone preflight reused unchanged; exit 2 for the exact-model mismatch |
| [host-search.txt](host-search.txt) | Historical reports, active Actions jobs, runner-inventory access failure and unchanged execution facility |

Inspection checkout: `bf7a668ef763358376093e9398542623bb635088`.
Execution: [run 40131015578](https://github.com/saadshahd/roundup/actions/runs/40131015578),
job `120982788248` (`build #3764 / build`), runner `GitHub Actions 1000193440`.
The boot id in `machine.txt` identifies this VM lifetime.

| Failed command | Reference | Failure | Actual exit |
|---|---|---|---|
| Preflight in `qualification.txt` | Inspection checkout above | Intel 8370C, requires exact 9V45 | 2 |
| `gh api repos/saadshahd/roundup/actions/runners` | Existing-host search | HTTP 403, resource not accessible by integration | 1 |
| `gh api repos/saadshahd/roundup/actions/jobs/120982788030/logs` | Active sibling Builder | HTTP 404, BlobNotFound; no identity obtained | 1 |

No reachable qualified host was identified. Historical 9V45 reports predate the
R23 candidate and expose no execution endpoint. Active job metadata identifies
runner names and labels, not CPU models or a remote execution channel. The denied
inventory request does not establish that no 9V45 hardware exists. The existing
Builder facility has no exact-model input and serializes this Issue's builds.
No resource was created and no execution/selection machinery was changed.

These are standalone preflight/search statuses, not performance observer results.
No release measurement build, timing invocation, diagnostic profile or calibration
was attempted; no release executable hashes or measurement settings exist for this
attempt. Lint/test binaries are not R23 evidence. A subsequent qualified run must
collect #3760's six invocations and both diagnostic profiles before its lifetime
ends, as `docs/perf.md`, heading “R23 execution lifetime (#3764)”, describes.
