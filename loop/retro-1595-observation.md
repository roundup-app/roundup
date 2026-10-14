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
