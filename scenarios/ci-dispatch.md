# Manually dispatched check

Acceptance for [#5915](https://github.com/roundup-app/roundup/issues/5915). Implementation scope: `.github/workflows/check.yml`, its aggregate-job comment and result predicate, plus a focused behavioral regression test beside the workflow at `.github/workflows/check.test.mjs`. No packaging cadence, lane selection, permissions, concurrency, draft admission or other workflow changes.

## Checks on main

1. Event admission and lane selection: `.github/workflows/check.yml`, `on.workflow_dispatch`, `jobs.plan` and `jobs.mac-package`. Packaging runs only for a push to `refs/heads/main`; dispatch runs the other lanes.
2. Required result: `.github/workflows/check.yml`, `jobs.check`, its `needs`, `if`, `NEEDS`/`EVENT` environment and `jq -e` step. The gate needs `plan`, `rust`, `mac-clippy`, `mac`, `mac-package`, `web` and `chromium`.
3. Existing regression boundaries: `scenarios/ci-mac.md`, CI5458a, CI5458b and CI5458d; `scenarios/loop-rules.md`, L89 parallel CI and L46 merge gate. Packaging remains required on main pushes and skipped on PRs. CI5915a adds only the dispatch exception to L89's PR-only skip rule; CI5458d's rejection of skipped packaging on main continues to apply to pushes.

## Acceptance

**CI5915a a manual main check accepts its intentional packaging skip.** Given Actions → check → Run workflow with branch `main`, when `plan`, `rust`, `mac-clippy`, `mac`, `web` and `chromium` succeed and `mac-package` is skipped by Check 1, then the aggregate `check` succeeds. Keep `mac-package` push-only; do not build packages on dispatch to make the gate pass. Planned test `ci5915a_dispatch_accepts_only_the_packaging_skip` executes Check 2's actual shell step with `EVENT=workflow_dispatch` and the complete `NEEDS` result map, asserting exit 0 for this row and exit 1 when each other dependency is individually skipped. The `plan` skip must fail too.

**CI5915b dispatch failures remain failures.** Given the dispatch result map in CI5915a, when any dependency individually reports `failure` or `cancelled`, including `plan` or `mac-package`, then the aggregate shell step exits 1. Planned test `ci5915b_dispatch_rejects_failed_or_cancelled_dependencies` executes that step for each dependency and each result; all other results remain as in CI5915a. A cancelled workflow retains Check 2's cancellation condition and cannot report a passing required `check` (policy, observed through the real Actions job conclusion).

**CI5915c push and pull-request gates keep their boundaries.** Given Check 2's complete result map, when the event is `push`, then all-success exits 0 and changing any one dependency to `skipped`, `failure` or `cancelled` exits 1. When the event is `pull_request`, then successful `plan` with skipped affected-test lanes, including `mac-package`, exits 0; individually skipping `plan` or changing any dependency to `failure` or `cancelled` exits 1. Planned test `ci5915c_push_and_pr_keep_required_results` executes the actual shell step for these rows. Draft admission, required-check naming and cancellation remain unchanged (policy; Check 2).

## Observer

Use the installed `yaml` dependency and Node's test runner to read the workflow and execute its actual aggregate shell step with fixture environment values; do not copy its predicate into the test or assert workflow text. This pins a required merge-gate boundary under AGENTS.md rule 10. The test file adds no production helper, parser or duplicate gate implementation. Run `node --test .github/workflows/check.test.mjs`; each failure reports the scenario, event, changed dependency/result, expected and actual exit codes, stdout and stderr. Each matrix row runs independently so a first failure cannot hide later rows.

| Event | Result-map row | Shell exit |
|---|---|---|
| `workflow_dispatch` | Only `mac-package` skipped; all others successful | 0 |
| `workflow_dispatch` | Above, plus one other dependency skipped (one row per dependency) | 1 |
| `workflow_dispatch` | Base dispatch row, one dependency failed (one row per dependency) | 1 |
| `workflow_dispatch` | Base dispatch row, one dependency cancelled (one row per dependency) | 1 |
| `push` | All successful | 0 |
| `push` | One dependency skipped (one row per dependency) | 1 |
| `push` | One dependency failed (one row per dependency) | 1 |
| `push` | One dependency cancelled (one row per dependency) | 1 |
| `pull_request` | `plan` successful; all other dependencies skipped | 0 |
| `pull_request` | All successful | 0 |
| `pull_request` | `plan` skipped; others successful | 1 |
| `pull_request` | One dependency failed; others successful (one row per dependency) | 1 |
| `pull_request` | One dependency cancelled; others successful (one row per dependency) | 1 |

Policy observer: after implementation merges, dispatch `check` on `main` using Actions or `gh workflow run check.yml --ref main`. Record its head SHA, run URL, event and each dependency/aggregate conclusion on #5915. A passing observation has `mac-package=skipped`, every other dependency successful and `check=success`. Retain any failed run and its causes on the Issue; a local predicate pass alone does not establish workflow scheduling. No Mac-only user observation is needed.

Applicable Principle: P5. Its gate asks whether work can reach `main` without green checks; Check 2 and CI5915b–c keep failed or cancelled dependencies from passing the required result. No product surface, contract or Message law changes.
