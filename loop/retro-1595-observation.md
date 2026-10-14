# L106 recorded closure causes

Refs #1595. The authorized pair and full reconciliation remain with #1308.

Complete main input → independent closure reads → repaired collector replay.

[Retro 38457744271](https://github.com/saadshahd/roundup/actions/runs/38457744271)
ran on main `c5a2efa00d87eca503c1246221675c5e6fde359c` and succeeded.
Its `retro-input` artifact (11845827923) fixes
`[2026-10-12T19:48:27Z, 2026-10-13T19:48:27Z)` and records collection at
`2026-10-13T19:48:42.233792Z`. The uncompressed input SHA-256 is
`c016b983e95559164d2df16c2e5ea7404b178bb25ae6218194a5ccf8b5c5c5d1`.
It counts nine closures correctly but gives six causes as unknown.

Fresh independent `gh api --paginate --slurp` reads on 2026-10-14 inspect
all nine PR comment and event histories, plus each of the three linked
fix-exhaustion comments. `retro-1595-source-reads.json.gz` retains those raw
reads, with real PR metadata read through GraphQL after the REST budget
was exhausted. `retro-1595-reconciliation.json` preserves the fixed window, PR close
timestamps, closing events and repaired cause rows; each original comment
retains its author, body, time and URL. The replay uses the collector's
`collect` boundary and these GitHub sources, not the report's guessed values.

| PR | Recorded cause comment | Independent finding |
|---|---|---|
| #1463 | 6144420358 | #1464 supersedes observation of the old collector |
| #1461 | 6145269796 | #1454 now asks for the web result |
| #1459 | 6145270516 | #1454 now asks for the web result |
| #1408 | 6139444401 | Empty PR; #1388 completed by #1390 |
| #1372 | 6139452689 | Partial #1370 evidence; #1370 closed with #1355 |
| #1317 | 6144421585 | Failed old observation; #1308 retains the live run |
| #1453 | 6148778402 | Recorded fix exhaustion |
| #1413 | 6148554008 | Recorded fix exhaustion |
| #1283 | 6149284514 | Recorded fix exhaustion |

The independent count is nine recorded causes and zero unknowns. Replaying
these source histories through the repaired collector yields the same count.
The six ordinary causes are explicit closing statements, not inferred from
rejections. The regression fixture `retro-1595-causes.json` retains all six
real comments and events, including the actual PR timestamps differing from
the event timestamp by one second.

Ordinary prose must start `Closed by <actor>: <explanation>`, come from an
`orders.AUTHORS` identity and fall within 60 seconds of this closing event.
The event must accompany the PR's current close timestamp within 60 seconds;
comments before the latest reopening do not explain the current closure.
Machine markers retain their existing forms, require trusted authors and
cannot reuse a previous closed attempt. Duplicate cause ids appear once.
Full comments remain available for semantic inspection; the script does not
classify the explanation's meaning.

The attempted fresh complete main collection in this Builder reached the
collector's core read reserve before completing. The observed budget was
62 remaining, resetting at `2026-10-14T00:43:29Z`; the run was terminated
with exit 143 instead of claiming a partial input complete. This document's
complete-input claim refers only to the successful main artifact above.
A fresh complete collection/publication on main after the repair merges
remains pending. #1595 stays open; this PR has Refs, not Closes.

#1308 keeps the authorized pair, full metric/unknown reconciliation,
same-date reuse, predecessor closure and repair allowance/duplicate checks.
The prior six unknown closure causes cannot complete that observation.

Collector regression: `python3 loop/retro.test.py` passes 61 tests.
`python3 loop/retro-observer.test.py` passes 31; the workflow suite passes
183; `loop/rules.sh vocab` passes. These are implementation checks, not the
pending fresh complete main observer.

Full `just check` exited 0 on this Builder branch: 1,631 Rust tests and
2,860 web tests passed, with the repository's existing skipped tests retained.
The REST quota subsequently reached zero for both configured tokens.
GraphQL confirms #1595 and #1597 remain open. The REST-based owner-closure
and readiness guard cannot complete until the core reset at
`2026-10-14T00:43:29Z`; this is recovery work, not a product question.

## Post-merge observation attempt, 2026-10-14

Merged #1597 → fresh independent sources → complete main input remains pending.

`retro-1595-main-source-reads.json.gz` retains new paginated comment/event
histories, direct PR metadata, the three linked fix-exhaustion histories and
all 12 pages of the closed-PR listing (1,197 distinct PRs). Filtering that
listing independently confirms the original window's nine unmerged PRs.
Every recorded comment retains its author, body, time and URL. The independent
count is nine recorded causes and zero unknown causes; the six ordinary owner
explanations and three machine markers match the earlier reconciliation.
`retro-1595-main-independent.json` links their closing events and comments,
records collection times and hashes the uncompressed source reads.

The complete collector attempt launched from main
`114fe273ef5ad0a39762f63bdcbb97c5a0192339` with:

```sh
python3 loop/retro.py --repo saadshahd/roundup input --end 2026-10-13T19:48:27Z
```

It reached the half-budget read reserve, with reset at `2026-10-14T05:44:13Z`.
After the main prerequisite below was recorded, it was terminated with exit
143. It produced no complete input; the fresh complete-main acceptance stays
open. After the prerequisite merges and budget is available, rerun that command,
retain its complete output and compare every closure/event/cause with the
independent records before adding Closes #1595.

On the launch checkout, `pnpm install` and a full `just check` passed: 1,661
Rust tests, 2,874 web tests and `ALL PROOFS CHECK`. The initial A32 prompt-read
failure passed in isolation and on that full retry. After merging main
`b0d75619`, `just check` exited 100: Q11's non-terminal capability probe runs
B6's fake Claude, whose `tty.setraw(0)` raises `termios.error: (25, 'Inappropriate
ioctl for device')`. The isolated B6 checked-effect test also exits 100 at
`crates/rupd/tests/b6_prompt_identity.rs:76` before reaching its assertions.
Existing #1708 owns the required revert of #1668 under the red-main rule;
#1595 is natively blocked on it. No production code or test assertion changed
in this evidence PR.

```sh
cargo nextest run -p rupd -E 'test(b6_a_checked_effect_completes_before_a_racing_prompt_replacement)'
```

After the main merge, all 62 collector and 155 workflow tests and the vocabulary
check pass. #1699 remains draft with Refs #1595. #1308 retains its authorized
publication pair and full reconciliation; the prior six unknown closure values
cannot complete it.

## Recovery attempt, 2026-10-14

Green main → complete collector attempt → quota waits → expired credential.

The previous main-check prerequisite #1708 is closed. Its final scope reverted
#1670 and the later fake-Claude probe answer, preserving #1668; the earlier
prerequisite description above records the diagnosis available at that attempt.

The original-window command above ran with main's collector at
`c8194f2677e7315d4121246577070d11f2296a2d` (script SHA-256
`18dc2cb8557a7fa84aff2567d7b63fde1fb808744925e86bdb1e9b8df00f2a1b`).
It retained the half-budget reserve and waited for resets at 12:37:49 and
13:37:50 UTC. After the second reset, the jobs read for run `38294356279`
returned `HTTP 401 Bad credentials`; collection exited 4. It produced no
complete input or resumable checkpoint. No successful live reconciliation is
claimed for this attempt. `retro-1595-main-independent.json` appends its command,
failure and prerequisite; the independent source archive and nine-cause audit
remain unchanged and their uncompressed source hash still matches.

[Repair #1749](https://github.com/saadshahd/roundup/issues/1749) owns collector
recovery across quota waits and credential expiry, then the original-window
complete input and exact event/cause comparison. #1595 is natively blocked on
it and remains open. The existing runner credential-renewal helper restored
push/readiness access, but could not recover the failed collector's lost reads.
#1308 retains its authorized publication pair and full reconciliation.
