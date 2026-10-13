# L107 authorized main observation

#1385 owns the dispatch authority repair. #1338 owns complete live acceptance and collector repairs. PR #1387 contains the authorized path and reproducible fixtures; no pre-merge dispatch is evidence of the main path.

```text
intent comment → main dispatch → durable run ID → terminal evidence
successful publication + preserved snapshot → same-date repeat
failed collection → dispatch evidence only → #1338 stays open
unknown delivery → retain intent → no redispatch
```

Reproduce the boundary fixtures:

```sh
python3 loop/care-observer.test.py
python3 loop/workflows.test.py
```

After merge, build's serialized non-model `care-observer` job runs from main with Actions-write authority. Neither Builder nor Care gains permissions. Care completion, including failure, routes back to build; the hourly build also resumes observation. `<!-- l107-observer -->` comments on #1385 persist intent before dispatch and pin the matching run ID before collection. Ambiguous or absent delivery fails with exit 4 and never resets the intent. Cancellation of #1385 or closure of #1338 stops observation. Completing the authority prerequisite permits its existing observation to finish; it authorizes no fresh intent.

For a completed run, the `l107-observer` artifact contains the run/jobs/artifact inventory, all downloadable Care artifacts and full log. A complete successful publication additionally records its source SHA, fixed window, complete ranked summary, publication journal and all-Issue snapshot. The observer independently counts bot-created Issues bearing the date's Care marker across open and closed Issues. An upload-completed workflow step preserves the first snapshot before immediately repeating and checks the repeat's window date and cumulative three-Issue cap. It records links and the full summary on #1338 without closing it.

A failed collector records the terminal run, log and available artifacts, makes no successful-publication claim and dispatches no repeat. Historical incomplete records remain subject to Care's existing exit-4 collector tests; this repair changes no collector, ranking or publication policy.

Once #1387 merges and #1385 records an authorized main run URL, #1385 can close as completed. #1338 retains reproduction of each new Issue's command against its pinned sources, module scope and preserved behaviour, Priority 60 or evidenced main-failure Priority 2, open-PR exclusions, open/recent-closed matching, no reopened user-closed Issue, and independently reconciled two successful publications. Download the linked snapshots and commit that live evidence through a reviewed PR. A failed collection proves only dispatch and belongs to #1338 for diagnosis and any scoped prerequisite.
