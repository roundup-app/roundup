# Loop dependencies

**L115 implementation inherits dependents.** When a specify run files implementation Issue C for specification Issue A, every open Issue B returned by `GET issues/A/dependencies/blocking` gains C as a native blocker before the run opens its specification PR. C remains blocked by A. Closing A as completed therefore releases C, while B waits for C's implementation. This specifies #1645; implementation owns the missing-prerequisite paragraph of `.agents/builder.md` and the Issue-filing step in `loop/builder.py`, with dependency reads shared through `loop/orders.py`.

- *Filing.* Read all pages of A's native blocking dependencies, select open Issues, and add C's GitHub database id with `POST issues/B/dependencies/blocked_by`. Exclude C itself. Preserve the A → C link and every existing blocker; add links rather than replace them. A fixture gives A blocking B and C, B already blocked by A and another Issue, and expects the recorded POST for B with C's id, no self-link, and no removal (`l115_implementation_inherits_open_dependents`). A paginated fixture includes two open dependents and a closed dependent; only the open dependents receive C (`l115_all_pages_skip_closed_dependents`).
- *Retry and failure.* Existing B → C links are successful no-ops; a retry after partial publication adds only missing links. A dependency read or write failure stops the filing step visibly and prevents opening or readying the specification PR until every required link is confirmed (`l115_retry_preserves_links`, `l115_dependency_failure_holds_specification_pr`). If implemented in `loop/builder.py`, reuse `orders.py`'s dependency reads, extending their direction without copying the GitHub client (`l115_filing_reuses_orders_dependency_reads`).
- *Recipe (policy).* Beside the missing-prerequisite paragraph, `.agents/builder.md` instructs specify runs to block C on A, add C as blocker of every open Issue A blocks, and finish those writes before opening the specification PR. Implementation stays open when the specification closes.

Checks on `origin/main` (constraints, not delivery evidence): 1. native dependency completion releases work (`.agents/data/work.md:19`); 2. an implementation Issue waits for its specification (`.agents/data/work.md:21`); 3. dependency reads already paginate through the shared client (`loop/orders.py:199`); 4. the missing-prerequisite recipe is the instruction's owner (`.agents/builder.md:35`).

The filing step's exit statuses are asserted by `l115_filing_exit_codes`:

| Result | Exit |
| --- | --- |
| Every required link confirmed, including an empty dependent set or a repeat | 0 |
| Dependency read fails or returns unusable data | 1 |
| Required dependency write fails or cannot be confirmed | 1 |
| Invalid command arguments | 2 |

Tests are implementation targets in `loop/*.test.py`, not existing-test claims.

Observer (policy): after implementation merges, the next specify run whose Issue A blocks an open Issue B files C. Record A, B, C and the run URL in a comment on the implementation Issue; verify GitHub reports B blocked by C and C blocked by A before the specification PR opens. After that PR merges, verify B still waits for C. The implementation Issue's comment names the B/C pair; fixtures provide regression evidence without waiting for this live run.
