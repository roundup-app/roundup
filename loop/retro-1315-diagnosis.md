# L106 historical collector read

Whole-history deadline → bounded page deadlines → complete input or a named failed page.

| Evidence | Result |
| --- | --- |
| Authorized Retro | [38341186753](https://github.com/saadshahd/roundup/actions/runs/38341186753), main `7b7b15b142264e09acb494824dbd67f77db70354` |
| Workflow-token failure | [Collector log](https://github.com/saadshahd/roundup/actions/runs/38341186753/job/115112311838#step:3:1), `2026-10-13T03:37:07Z`: `actions/workflows/check.yml/runs?per_page=100`, paginated read exceeded 180 seconds; exit 4, no artifact, model or publication |
| Diagnosis | The subprocess timeout covers the entire historical pagination, whose size grows independently of the fixed 24-hour window. It does not bound individual page latency. |
| Existing interface regression | `test_l106_historical_check_pages_have_individual_timeouts` fails on the original `GitHub.read` with the same `TimeoutExpired` and endpoint; after repair it collects all 1,201 fixture runs across 13 individually bounded requests. |
| Failure regression | `test_l106_failed_historical_page_emits_no_partial_input`: page 2 timeout exits 4, names endpoint/page and timeout, emits no input, never retries or requests page 3. |
| Live cross-check | On `2026-10-13`, Builder's App credential read `total_count: 4708` for the exact historical endpoint: 48 pages at 100 rows. This is not Retro-token evidence. |
| Live repaired read | Builder's App read stopped on page 25: HTTP 504 Gateway Timeout, request ID `A440:1FE67C:377100:71DB37:6ACDBBDC`, remaining core budget 6478. GitHub stderr: “We couldn't respond to your request in time.” No retry or complete-input claim. |

The repair bounds and paces each historical check page through the existing request boundary, retains all rows, and keeps deduplication, required-field validation and the total-count completeness check. The interval, role permissions, schedules, model, repair policy and independent gates are unchanged. An individual page timeout or HTTP failure still stops collection. Earlier HTTP 502s remain separate server failures; the original run 38309102644 discarded its response and its cause remains unknown. No evidence establishes a newly introduced main regression requiring a revert.

#1315 remains open for a main Retro workflow-token collection, its complete `retro-input` artifact and exact window. #1308 owns dispatch-ledger recovery, two successful publications and independent metric reconciliation. Prior failed runs and observer intents remain intact.
