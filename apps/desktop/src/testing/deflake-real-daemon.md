# Real-Daemon render-wait observation

Refs #1357. Scenarios: U356, U351, U146, U166, U177.

Observed main commit `35ab1855d4c0debe8ea869689486a61bde2d6d92` on the Linux runner in [Builder run 38345715731](https://github.com/saadshahd/roundup/actions/runs/38345715731).
Render waits merged in #1246 (U356) and #1360 (U351 and the three Door files).
This observation changes no assertion, timeout or application behavior.

```sh
pnpm --filter desktop exec vitest run \
  src/testing/u146_door_answers.test.tsx \
  src/testing/u166_door_permission.test.tsx \
  src/testing/u177_restarted_door.test.tsx
```

Run that command 20 times sequentially, stopping on any nonzero exit.
Started alongside `just check`; a full `pnpm --filter desktop exec vitest run` supplied concurrent load throughout the sequence.
Each repetition starts fresh Vitest workers and fresh real-Daemon Projects.
The five files contain six tests, including both U166 answers.

| Observer | Result |
| --- | --- |
| Twenty consecutive repetitions of all five files under load | Passed: 100 file runs, 120 test cases |
| Final `just check` | 1,530 Rust tests passed; proofs, lint, type and slop checks passed; web: 2,553 passed, two skipped, one U26 timeout |
| Following 24 hours without a named CI failure | Pending through at least 2026-10-14 04:12:06 UTC |

The first cold-build attempt failed U166's 120-second `beforeEach` while Cargo waited for the shared build lock; its deny test body never ran. The other five test cases passed. That attempt is excluded from the consecutive sequence, restarted after compilation completed. Timeout budgets remain unchanged.

The extra desktop-suite load exited 1: 299 files passed, eight failed and one was skipped; 2,540 tests passed, 14 failed and two were skipped. Failures were in U370, U133, U26, U132, U170, U134 and U136; all five Issue files passed in this load run too. Its outcome is separate from `just check`.

## Consecutive repetitions

Started 2026-10-13 04:23:43 UTC; finished 04:40:28 UTC. Each command exited 0.

| Run | Duration (seconds) | Files | Tests |
| --- | --- | --- | --- |
| 1 | 44.44 | 5 passed | 6 passed |
| 2 | 44.55 | 5 passed | 6 passed |
| 3 | 47.03 | 5 passed | 6 passed |
| 4 | 48.11 | 5 passed | 6 passed |
| 5 | 47.78 | 5 passed | 6 passed |
| 6 | 47.62 | 5 passed | 6 passed |
| 7 | 53.17 | 5 passed | 6 passed |
| 8 | 51.03 | 5 passed | 6 passed |
| 9 | 50.24 | 5 passed | 6 passed |
| 10 | 45.69 | 5 passed | 6 passed |
| 11 | 51.30 | 5 passed | 6 passed |
| 12 | 59.32 | 5 passed | 6 passed |
| 13 | 48.30 | 5 passed | 6 passed |
| 14 | 55.37 | 5 passed | 6 passed |
| 15 | 42.34 | 5 passed | 6 passed |
| 16 | 46.12 | 5 passed | 6 passed |
| 17 | 44.03 | 5 passed | 6 passed |
| 18 | 46.52 | 5 passed | 6 passed |
| 19 | 35.44 | 5 passed | 6 passed |
| 20 | 43.42 | 5 passed | 6 passed |

| Test | Longest body (seconds) | Existing budget (seconds) |
| --- | --- | --- |
| `u356` | 27.95 | 420 |
| `u351` | 27.80 | 420 |
| `u146` | 3.79 | 120 |
| `u166_allow` | 14.20 | 240 |
| `u166_deny` | 10.03 | 240 |
| `u177` | 10.18 | 300 |

The U104 failure was `u104_snapshot_cuts_old_history_before_the_visible_screen_at_one_megabyte`: `the Terminal exits in time: Elapsed(())`, before the web lane ran. It does not change the five-file observation.

Main's first post-merge [check run 38345302504](https://github.com/saadshahd/roundup/actions/runs/38345302504) passed. Before final validation, merged main `5316d57d` (loop-observation documentation only); the diff against main contains only this observation file.

Final web failure: `u26_a_pad_the_agent_owns_opens_in_its_drawer` exceeded its existing five-second test budget. The unchanged case passed when rerun in isolation (body 1.60 seconds). All five Issue files also passed in the final full suite. No unrelated test was changed to obtain these results.
