# Issue-list recovery

**L34a Warm Issue reads recover through the full-list fallback.**

Given `$ORDERS_CLOSED_CACHE` names an existing closed-Issue cache, when the REST open-Issue list is empty or raises `subprocess.CalledProcessError`, `loop/orders.py`'s `list_issues` uses the full-list recovery that `all_issues` provides, including `gh issue list` when REST is empty or fails. An empty warm open list alone never proves the queue is empty.

- With either trigger injected and GraphQL returning an authorized open work Issue and closed Issues, `list_issues` returns those Issues once each and `classify` reports the same Issue states as a cache-free read of that full list (`test_l34a_a_warm_open_list_recovers_the_full_queue`, planned in `loop/orders.test.py`; table both triggers). Include a cached closed Issue now reopened and a closed Issue sharing another open Issue's Key: recovery removes the reopened Issue from the closed cache and retains duplicate-Key blocking. The rewritten cache contains exactly the recovered closed Issues (`test_l34a_a_warm_open_list_recovers_the_full_queue`).
- When recovery cannot obtain a full list because the fallback fails or both sources return empty, the read raises with a visible error, returns no successful queue result and leaves the existing cache bytes unchanged (`test_l34a_failed_warm_recovery_preserves_the_cache`, planned in `loop/orders.test.py`; table a failed GraphQL call and an empty GraphQL list after empty REST replies).
- A nonempty warm REST open list keeps the incremental path: one open-list call and one changed-closed-list call, with no full-list or GraphQL read (`test_l34a_a_nonempty_warm_open_list_stays_incremental`, planned in `loop/orders.test.py`).

Checks on `main`:

1. `loop/orders.py`, `all_issues`: empty REST results and `subprocess.CalledProcessError` select GraphQL; an empty GraphQL result raises rather than returning an empty queue.
2. `loop/orders.test.py`, `Orders.test_l34_an_empty_rest_issue_list_reads_issues_through_graphql`: a recovered authorized open Issue is ready through `classify`.
3. `loop/orders.test.py`, `Orders.test_l34_a_cached_closed_issue_still_blocks_a_duplicate_key_and_a_reopened_one_leaves_the_cache`: the nonempty warm path uses two calls, retains duplicate-Key blocking and removes reopened Issues from the closed set.

Observer: the planned tests exercise the real `list_issues` and `classify` with a temporary cache and injected `gh` replies/errors; they start no subprocess and require no GitHub incident. Existing L34 cache and cold-read tests remain regression observers. This acceptance adds no queue policy or retry schedule.
