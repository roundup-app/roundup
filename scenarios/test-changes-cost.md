# Changes restoration test cost

Module: `apps/desktop/src/changes/`. Source: #4982. Acceptance is policy for implementation and independent review; add no test that reads test source, counts declarations or checks this document. U2773a/c/e (`scenarios/unfinished-input.md`) and AGENTS rule 10 remain in force.

**T4982a remove duplicate Changes restoration proofs.** Given the ten declarations below, when their assertions and setup are audited, then each has one disposition in the implementation PR: cut, make cheap, or keep (policy). For every cut, name the surviving test whose body detects the same behavioral break and its scenario clause. For a replacement or consolidation, map every original to its replacement; for a kept test, identify the distinct break no cheaper surviving test detects. Include both executed cases of the parameterized declaration. Apply rule 10 to the entire edited test file, accounting for additional cuts in the same way.

| Original declaration in `apps/desktop/src/changes/u2540b_notes.test.tsx` | Behavior to account for |
| --- | --- |
| `u2773a_changes_agent_switch_restores_form` | Agent-specific form values and ranges after switching |
| `u2773a_changes_restores_exact_work` | Saved batch and unfinished exact form/range after fresh mounting; zero sends |
| `u2773a_changes_project_switch_restores_caret_without_background_focus` | Project isolation, exact text/caret, incoming-event focus and zero sends |
| `u2773e_recovery_actions_keep_surface_draft` | Failed-write memory and stored bytes, copy, explicit retry and selected discard across reopening |
| `u2773e_changes_restore_failure_keeps_memory_%s` (`invalid`, `unreadable`) | Visible restore failure, unchanged malformed bytes and recoverable newer memory |
| `u2773c_changes_worktree_loss_and_return_keep_original_form` | Original form recovery while its Worktree is unavailable and after return |
| `u2773c_changes_unavailable_original_keeps_recovery` | Unavailable original cannot resume into an equal-named replacement; exact copy retains recipient/comparison |
| `u2773e_changes_retry_read_keeps_older_work_separate` | Explicit read retry keeps older stored and newer memory work separately recoverable |
| `u2773a_changes_recovery_switch_keeps_single_editor` | Recovery-to-Changes navigation retains the latest editor work without sending |
| `u2773e_changes_connection_replacement_keeps_memory` | Connection replacement keeps failed-write memory; explicit send uses the new connection and original recipient once |

Policy: use one canonical Changes category observer for each repeated restoration claim, reusing the existing category tests and shared storage proofs where their assertions detect that break. Do not keep multiple tests solely because each exercises a different restore trigger already covered by those proofs. Distinct identity, conflict, recovery-action, focus or delivery breaks retain their own behavioral observer when not detected elsewhere. One test walking unrelated clauses in sequence is not consolidation. At least one redundant original declaration must be removed; renaming or moving all ten unchanged does not meet this acceptance. No required product clause is retired.

Policy: inspect the current import chain before choosing a seam. At the specification base, `openDiff` calls `mountControl`, which uses `FakeApp` and `connectProject`; these local tests already start no Daemon. Use the existing App/storage seams, jsdom remounts and shared Project/storage observers for local retention. Do not introduce a real process, browser, Daemon or new test harness to replace these tests. Keep the real accepted-effect observers required by U2773g elsewhere unchanged.

**T4982b demonstrate reduced cost on the implementation head.** Given T4982a's dispositions, when the affected suite passes before and after the implementation, then record on #4982 the base/head SHAs, exact commands, environment, executed test counts, per-file elapsed test seconds and totals including every replacement outside the original file (policy). Use matching runner, concurrency and retry settings, separating retries and setup time; count each executed replacement file once. The original-file-plus-replacement total must decrease. The reported approximately 33 s is historical motivation, not a fresh baseline or a fixed budget. Obtain a successful base CI run and successful implementation-head `check` run, recording their URLs/SHAs and affected file timings using `loop/web-durations.py`; missing timings are incomplete evidence, never zero. No increased timeout, retry, skipped case or weakened assertion may supply the reduction.

Policy: implementation scope is the Changes tests and their existing setup, plus observer clarifications in `scenarios/unfinished-input.md` if a named proof moves. Shared storage tests may be cited unchanged; modifying another module requires an explicit scope expansion on #4982. No product, contract, dependency or frozen loop change is authorized. Verify changed test files with `pnpm --filter desktop exec vitest related --run <changed files>` after `just ready`. Progress and engineering questions stay on #4982.

## Checks on main

1. `apps/desktop/src/changes/u2540b_notes.test.tsx`, the ten declarations above: current assertions are the audit input, not proof that all ten are necessary.
2. `apps/desktop/src/changes/noteHarness.tsx`, `openDiff`; `apps/desktop/src/changes/harness.tsx`, `mountControl`: existing connected-App setup without a real Daemon.
3. `scenarios/unfinished-input.md`, U2773a, U2773c, U2773e and U2773g: exact input, identity, conflict, retention failure and journey obligations remain required.
4. `apps/desktop/src/state/u2773_storage.test.ts`, `u2773a_storage_restores_exact_work` and `u2773a_shared_project_restores_exact_work_across_switch_and_connection_replacement_%s`: inspect these shared restoration proofs before duplicating their assertions.
5. `scenarios/test-cost.md`, T3779c and Measurement and regression policy: preserve clause-to-observer mapping and comparable successful CI timing evidence.
6. `AGENTS.md`, Rules, rule 10: retained tests must detect a distinct behavioral break at the cheapest sufficient seam.

Policy — P11 applies: does a cut leave lost or altered unfinished work, substituted original identity, restore-triggered delivery or hidden retention failure undetected? Independent review answers using surviving test bodies mapped to each inventory row, then runs those tests. This specification changes no visible UI, so it requires no new rendered capture.
