# Lint lanes and command callers

Module: `justfile`, root `package.json`, lint documentation and existing check lanes. Ids: T5464a–T5464d.
Source: work Issue #5464. This specification defines acceptance; it changes no command or CI lane.

**T5464a each repo-wide scan has one required lane.** Given a ready PR, including a scenario-only PR with no web selection, when `pre` runs, then the repo-wide size, ast-grep, typos and Ruff scans run exactly once through `lint-repo` in `lint-rust`; `lint-web` runs none of them (policy: inspect the complete recipe/script call paths and the implementing head's CI logs). Keep L5398's always-reached `lint` job and web-job selection. A PR containing only a new spelling violation fails the `lint` job and the aggregate `pre`, with that violation reported by no other lint job (policy: observe a temporary mutation, restore it before committing, retain both lane logs and statuses). No scan, scanned path, failure status or existing debt ratchet is removed or relaxed.

The existing L5398 dry-run test (Check 3) remains the gate-boundary test. It observes only commands printed directly by just; independent review also follows package scripts so an indirect scan cannot evade the once-only requirement (policy). The real-tool tests in Check 4 retain their spelling, size, AST, Python and failure-contract proofs. Do not add a second recipe-text test for this acceptance.

**T5464b retained contract observers run outside pre.** Given the C4 addition and freshness observers in Checks 5–6, when CI reaches the contract test lane, then both observers execute and fail the required `check` result when their assertions fail (policy: inspect CI execution, not just a recipe mention). Keep `contracts-test` and wire it into one existing Linux Rust partition in `check.yml`, once per eligible run, outside `pre`. Changes to these observers, their fixtures, the contract declarations/generator or their recipe must select that lane; demonstrate that selection with the existing planner, without editing frozen `loop/` files (policy). Preserve `contracts-fresh` in `test-rust` and its regeneration-before-comparison behavior.

`test_c4_one_declaration_reaches_every_surface` asserts addition, invocation, removal and MCP exposure through the real generated surfaces. `test_c4_contracts_fresh_detects_drift` asserts clean/repeated generation and mutated outputs/declarations, including generator failure. These are distinct from running `fresh.py` against only the committed tree. Neither observer is deleted merely because the recipe lacked a caller. Repair a failing observer within its existing C4 acceptance; no new RPC method or generated output is committed for the probe (policy).

**T5464c obsolete checks leave no dead commands.** Given the cleanup, when a contributor runs the lint recipes, then the following removals and preserved boundaries hold (policy: diff, caller audit and the command observations below).

| Surface | Required result |
| --- | --- |
| `tools/clippy/selection.test.py` | Delete the stand-in test and its `lint-rust` invocation. Retire Z4505's four stand-in test obligations and its requirement to register them in `lint-rust`; amend `scenarios/clippy-selection.md` accordingly. Keep its recipe behavior as policy: failed selection fails closed with the diagnostic and no compiler invocation, successful empty selection skips, nonempty selection or no base runs all-target Clippy with warnings denied and propagates failure. Preserve the standalone selector assignment under `set -euo pipefail`. No replacement fake-command test. |
| `spikes/context-injection/e7_report.test.sh` | No live scenario names this report-text test. Delete it and its `lint-rust` invocation. Retire its three text/existence assertions; E7's real injection observation, report, script and stub remain. A grep of a completed report is not that observation. |
| Root `package.json` | Delete `test:token-integration` and the missing-file-guarded `tokens:check`; remove `pnpm tokens:check` from `lint-web`. |
| `docs/u478-*`, `.fallowrc.json` | Delete all four existing `u478-` documents/tests and the contrast-observer entry in fallow. Preserve active UI token checks and styling lints; this retires the old documentation-only integration/contrast assertions, not U4 or the live UI token acceptance. |

This scenario supersedes only Z4505's automated stand-in observer requirements, not its Clippy behavior. C4's acceptance and E7's real observation remain required. No test is replaced by another test of a double or by a source-text assertion (policy).

**T5464d every retained command has a caller without adding pre work.** Given the final `justfile` and root `package.json`, when each recipe and script is audited, then each has at least one executable caller in CI, another recipe/script or a hook, or a document explicitly instructing a person to run it (policy). Record one row per retained command with its caller file and recipe/script/job/heading, plus the actual invocation. Its own definition, a test double, an incidental mention or a cycle of otherwise unreachable recipes is not a caller. Follow executable chains to CI, a hook, a package-manager lifecycle event or an explicit human run instruction. Include automatic `prepare` and `postinstall` lifecycle callers. Delete an unused command or document its existing human purpose; do not invent a purpose merely to retain it. Put this inventory in `docs/lint-callers.md`, and update instructions that name removed commands (policy).

The implementation adds no command, install, scan or test to either `pre` job, and preserves their current job selection. Keep the once-only scan already held by L5398. Removing the checks above and redundant version-only invocations may reduce work; wiring C4 observers happens only after `pre` (policy: compare the expanded call paths against the implementation base). Record before/after lint-command durations on the same runner with the same dependency/tool cache state, commands and base argument. Report both durations without claiming a speedup from unlike cache states. A new pre workload, slower command introduced by this change or reduced scan coverage fails this acceptance; CI scheduling noise alone does not establish a workload regression (policy).

## Command observations (policy)

On the implementation head run `just lint-rust origin/main` and `just lint-web`; each exits 0 on the clean tree. Run the retained contract observers through `just contracts-test`; both execute and exit 0. Do not run the whole Rust or web suite to observe this cleanup. For the spelling mutation use an isolated tracked text fixture outside frozen paths, verify the normal scanner rejects it, observe both lint entry points, then remove it. Record each invocation separately, including failures, timeouts and unavailable tools. A missing observation is not a pass.

| Command/result | Exit | Required evidence |
| --- | --- | --- |
| Clean `just lint-rust origin/main` | 0 | Complete lint output and elapsed time |
| Clean `just lint-web` | 0 | Complete lint output and elapsed time |
| `just contracts-test` | 0 | Both C4 observers executed, not zero discovered tests |
| Repo-wide scan with a new spelling violation | 1 | File and spelling diagnostic |
| `just lint-rust origin/main` with that violation | Nonzero | Scan diagnostic; failed invocation recorded separately |
| `just lint-web` with that violation alone | 0 | No repo-wide scan or spelling diagnostic |
| Incomplete scan | Nonzero | Command, cause and actual exit code; never a clean result |
| Unavailable tool | Nonzero | Tool, command and actual exit code |
| Failed setup | Nonzero | Setup command, cause and actual exit code |

No frozen `loop/`, `.agents/`, `AGENTS.md` or workflow other than `check.yml` changes. No new scan runner, parser, command store or inventory checker is needed. The command inventory and CI call-path observations are review policy, not new tests that reread configuration. If an implementation adds machinery, AGENTS.md rule 9 still applies.

## Checks on main

1. `justfile`, recipes `lint-repo`, `lint-rust`, `lint-web`, `contracts-test`, `contracts-fresh` and `test-rust`: current entry points and contract generation/freshness execution.
2. `.github/workflows/pre.yml`, jobs `lint`, `plan`, `lint-web` and `pre`: every ready PR reaches `lint`; web selection does not gate that job. `.github/workflows/check.yml`, job `rust`: existing Linux Rust partitions outside `pre`.
3. `loop/lint-repo.test.py`, `LintRepo.test_l5398_repo_wide_scans_run_in_the_lane_every_pr_runs`; `scenarios/lint-suite.md`, heading L5398: once-only scan gate and always-reached lane. Keep the frozen test unchanged.
4. `tools/lint/scan_test.py`, class `Lints`, tests `test_t3797a_spelling`, `test_t3797a_python`, `test_t3797a_size_cap`, `test_t3797a_sleep_polling`, `test_t3797a_dom_cloning`, `test_t3797a_style_overrides` and `test_t3797a_lint_failures`: real-tool boundaries. `tools/lint/scan.py`, `inventory`, `compare` and `main`: inventory, ratchet and failure statuses.
5. `tools/contracts/test_addition.py`, `Addition.test_c4_one_declaration_reaches_every_surface`; `tools/contracts/test_fresh.py`, `Freshness.test_c4_contracts_fresh_detects_drift`: existing C4 behavioral observers.
6. `scenarios/contracts-specta.md`, heading C4; `tools/contracts/fresh.py`, functions `drift` and `main`: required addition/freshness acceptance and regeneration with retained drift evidence.
7. `scenarios/clippy-selection.md`, heading Z4505; `scenarios/awareness.md`, heading E7: Clippy behavior and real injection observation whose acceptance remains after test retirement.
8. `AGENTS.md`, Rules 2, 9 and 10 and The loop: callers, reuse, test value and frozen machinery.

## Principles

This changes engineering commands and their observers, with no product behavior, contract or UI changes. No Principles Gate gains a path. Existing P4 vendor boundaries and P9 launch authority stay unchanged: no observer starts a real vendor program. Observers are Linux commands and CI logs; no Mac-only observation is required (policy).
