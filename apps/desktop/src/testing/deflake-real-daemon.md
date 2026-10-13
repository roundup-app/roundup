# Real-Daemon render-wait observation

Refs #1357. Scenarios: U356, U351, U146, U166, U177.

Observed main commit `35ab1855d4c0debe8ea869689486a61bde2d6d92` on the Linux runner in [Builder run 38345715731](https://github.com/saadshahd/roundup/actions/runs/38345715731).
Render waits merged in #1246 (U356) and #1360 (U351 and the three Door files).
This observation changes no assertion, timeout or application behavior.

```sh
pnpm --filter desktop exec vitest run \
  src/testing/u356_blocked_real_daemon.test.tsx \
  src/testing/u351_kinds_real_daemon.test.tsx \
  src/testing/u146_door_answers.test.tsx \
  src/testing/u166_door_permission.test.tsx \
  src/testing/u177_restarted_door.test.tsx
```

Run that command 20 times sequentially, stopping on any nonzero exit.
Concurrent load: `just check` and a repeated `pnpm --filter desktop exec vitest run`.
Each repetition starts fresh Vitest workers and fresh real-Daemon Projects.
The five files contain six tests, including both U166 answers.

| Observer | Result |
| --- | --- |
| Twenty consecutive repetitions of all five files under load | In progress |
| `just check` | In progress |
| Following 24 hours without a named CI failure | Pending through at least 2026-10-14 04:12:06 UTC |

The first cold-build attempt failed U166's 120-second `beforeEach` while Cargo waited for the shared build lock; its deny test body never ran. The other five test cases passed. That attempt is excluded from the consecutive sequence, restarted after compilation completed. Timeout budgets remain unchanged.

The extra desktop-suite load exposed failures outside this Issue (U370, U133 and U26); its outcome is recorded separately from `just check`.
