# Remove finished work orders and retired scenario files

Acceptance for #5466. Scope: the scenario inventory below, its inbound references in non-frozen documentation/scenarios, the two unused App glossary rows named by the Issue, and the permission spike audit. All clauses are policy, observed by independent review, repository greps and the existing scenario lints; add no source-text test, scanner or runtime machinery.

The implementation uses the inventory from its fetched `origin/main` SHA, recorded on #5466. Each stem below identifies the file in `scenarios/` with suffix `.md`; stems deliberately avoid leaving a reference to a deleted path in this specification.

| Disposition | Stems |
| --- | --- |
| Remove completed one-shot work orders and retired stubs | `busiest-file-split`, `rail-file-split`, `test-file-split`, `inventory-proof-references`, `measurement-write-recovery`, `store-migrations`, `ui-scrollbar-nested` |
| Remove files with every heading retired | `decisions`, `workstream-dashboard` |
| Remove only after the live-test scan in T5466b | `rewind-test-cost`, `test-changes-cost`, `test-ownership` |

**T5466a finished specifications leave no dangling reference.** Given the first two inventory rows, when the cleanup lands, then their files are absent and every inbound reference points to the surviving requirement, proof or retirement entry instead (policy). Repair all tracked references, including this specification and historical baseline/retirement tables, rather than leaving broken links labelled historical. In particular:

- `docs/evidence-relocation.md` points to the surviving relocated proof and its behavioral scenario, rather than the finished split order (policy).
- `scenarios/project-store.md` points to its N20 retirement policy for the old adoption requirements (policy).
- `docs/control-channel.md` and `scenarios/control.md` point to A3564a–f in `scenarios/native-questions.md`, or the retained spike finding when the citation describes an observation rather than acceptance (policy).
- `PRINCIPLES.md` and `scenarios/remove-time-timeline.md` point to the surviving removal/no-cost policy. P14 continues to prohibit cost, price and token counts; it no longer promises the removed time view (policy).
- Scrollbar references point to U3530a–c in `scenarios/ui-scrollbar-overflow.md`; preserve their existing overflow, overlay, containment and no-resize acceptance (policy).

A reference in frozen loop machinery must be cleared by the owner before its target is deleted; this work does not authorize editing that machinery or excluding it from the final grep (policy).

Keep `scenarios/ui-decisions.md` and its retired headings: frozen `loop/plans/` history still cites it. It is outside the removal inventory (policy).

No product behavior, public interface, Message law, test name or test assertion changes. A removed one-shot engineering order does not retire the behavioral scenarios its tests prove. Keep all acceptance outside the named obsolete material, and change mixed documents only to repair those references or remove the obsolete promise explicitly named above (policy).

**T5466b live tests prevent an unproved retirement.** Given each file in the third inventory row, when its removal is considered, then collect every scenario heading ID before editing and search all tracked test declarations case-insensitively for each ID as a scenario-name prefix (the lowercase ID followed by `_`, including parameterized declarations and tests reached through helpers) (policy). Search across the repository, not only the file's original module. Compare complete prefixes so an unlettered ID cannot hide a lettered sibling. Record each ID, search command, result and disposition on #5466. Only an empty match set permits deletion; any match retains that file and its IDs, records the exact test/path on the Issue and leaves its acceptance intact. Do not rename or delete a live test to permit a documentation cut (policy).

**T5466c deleted IDs remain reserved once.** Given the headings in every file actually deleted, when their files disappear, then each ID has exactly one canonical retirement entry in `scenarios/native-questions.md` or an existing retirement list in a surviving scenario (policy). Capture the complete heading inventory from the base before deletion, including lettered IDs; compare it with the resulting retirement entries. Consolidate existing entries rather than duplicating them. Use a retirement heading `**<ID> retired.**` for each reserved ID so the existing duplicate-heading lint (Check 1) rejects reuse. Keep the retirement cause and a surviving successor ID when one exists; completed engineering orders are marked completed and retired, not unsatisfied product work (policy).

The native-question inventory already reserves the removed question/permission scenarios: preserve that information, remove deleted file-path citations and make it refer to the canonical entries. Retired IDs are no longer active requirements. Ordinary mentions of an ID in explanatory prose are not a second canonical retirement entry (policy).

**T5466d unused glossary rows disappear and reproducible evidence stays.** Given the two App glossary rows named on #5466, when a tracked-repository search excluding `GLOSSARY.md` confirms no use of either term or its identifier spelling, then remove only those rows (policy). If the implementation base has gained a use, retain the used row and record its path on #5466. Do not remove callers or rename an identifier to manufacture an unused row. Follow the Contract recipe for this glossary edit; independent review covers it, with no new domain term or runtime contract (policy).

Given `spikes/hooks-permission/REPORT.md`, heading **H1b macOS**, when the six files in its named script directory are audited, then retain all six while that report uses them to reproduce findings 24–32 (policy). The current report describes each script's role and the run commands, so absence of references elsewhere is insufficient evidence for deletion. Record the finding-to-script evidence on #5466; add no new vendor run or Mac observation. Only if the implementation base no longer needs any of them for a retained finding may the entire directory be removed, after checking all tracked inbound references (policy).

**T5466e the remaining specifications and queue are readable.** Given the implementation head, when the existing checks and the probes below run, then all rows have their stated results and #5466 records the base/head SHAs, commands and outcomes (policy). For each unexpected failure, record a separate row with the command, offending path/ID or Issue number, and actual exit code. No new guard, dependency, frozen loop edit, or test-source assertion is required (policy).

| Probe | Required result / exit |
| --- | --- |
| For every deleted file path and any deleted directory path, `git grep -n -F -- "$deleted_path"` over all tracked files | No output; exit 1 (exit 2 or higher is an error, not success) |
| Base-heading inventory compared with canonical retired headings on the head | No missing, duplicated or newly active deleted ID; policy review passes |
| Per-ID live-test declaration search for each third-row file | No match for every deleted file; otherwise retain it and report the match |
| `loop/rules.sh scenario-ids` (Check 1) | Exit 0 |
| `loop/rules.sh laws` (Check 2) | Exit 0; existing law/observer mappings survive |
| `loop/rules.sh vocab` (Check 3) | Exit 0 |
| `python3 loop/orders.py ready --json` (Check 4) | Exit 0; every open work Issue is read; no Issue acquires a missing specification or scenario ID because of this cleanup |

Inspect the queue rows as well as the command's exit code: a successful queue read may still describe an invalid order or an order needing specification. Compare with the base queue; repair a cleanup-caused reference on its owning Issue using the validated Filing recipe, rather than changing loop machinery or dropping the Issue. Unrelated queue problems are recorded separately, not attributed to the cleanup (policy).

## Checks on main

1. `loop/rules.sh`, `scenario_ids`: rejects duplicate scenario headings across the surviving files.
2. `loop/rules.sh`, `laws`: validates law-to-observer mappings in surviving scenarios.
3. `loop/rules.sh`, `vocab`: enforces public-name vocabulary; `AGENTS.md`, Rules, rule 6, remains unchanged.
4. `loop/orders.py`, `all_issues`, `order` and `read_orders`; `.agents/data/work.md`, heading **Work orders**: GitHub work Issues are the queue and scenario headings resolve their acceptance.
5. `scenarios/native-questions.md`, heading **Retirement inventory (policy; old names appear here to identify removal)**: existing canonical native-question retirement inventory.
6. `scenarios/project-store.md`, N20; `scenarios/remove-time-timeline.md`, U4454a–d; `scenarios/ui-scrollbar-overflow.md`, U3530a–c: surviving policies for schema retirement, time removal and scrollbar replacement.
7. `spikes/hooks-permission/REPORT.md`, heading **H1b macOS**: the six scripts support retained findings 24–32.

Applicable gate: P14, does the changed documentation promise cost/token computation or display? Observe the retained prohibition in `PRINCIPLES.md` and its repaired references (Check 6). All other product paths, UI and runtime behavior are unchanged; this cleanup claims no new product capability, rendered observation or Mac proof (policy). Progress and engineering questions belong on #5466, never in scenario Work tables.
