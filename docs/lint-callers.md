# Lint lanes and command callers

Repo-wide size, ast-grep, typos and Ruff scans run once in `pre.yml`'s always-reached `lint` job: `lint-rust → lint-repo → scan.py web`. The selected `lint-web` job runs no repo-wide scan. Cargo dependency scanning stays in `lint-rust`; styling, token enforcement, type checking, dead code and cycles stay in `lint-web`. No scanned path or debt ratchet changes.

C4's addition/exposure/removal and mutated-generation freshness observers run through `just contracts-test` in Linux `rust 1`, outside `pre`. `contracts-fresh` still regenerates before comparing in `test-rust`. The existing planner selects Rust for contract declarations/generator, `contracts/`, `justfile` and `check.yml`; `check.yml` also selects Rust for `tools/contracts/` changes, including fixtures.

## Retained just recipes

Each executable edge below reaches CI or the human instructions below; none depends on a test double or an otherwise unreachable cycle. Arguments shown as `<…>` are supplied by the caller.

| Recipe | Caller file and recipe/job/heading | Invocation |
| --- | --- | --- |
| `check` | `AGENTS.md`, Conventions | `just check origin/main` |
| `check-rust` | `justfile`, `check` | `just check-rust <base>` |
| `check-web` | `justfile`, `check` | `just check-web <base>` |
| `ready` | `.agents/builder.md`, Code | `just ready` |
| `lint-repo` | `justfile`, dependency of `lint-rust` | `just lint-rust <base>` |
| `lint-rust` | `.github/workflows/pre.yml`, `lint` | `python3 loop/app-data.py just lint-rust` |
| `clippy` | `justfile`, `lint-rust`; `check.yml`, `mac-clippy` | `just clippy <base>`; `just clippy` |
| `test-rust` | `justfile`, `test-rust-since` | `just test-rust <selection> <args>` |
| `test-rust-since` | `check.yml`, `mac`; `tools/e14/observe.py`, Rust lane | `python3 loop/app-data.py just test-rust-since "$BASE" --profile mac`; `python3 loop/app-data.py just test-rust-since <base> --profile ci<N> --test-threads 4 --config-file <generated-config>` |
| `lint-web` | `.github/workflows/pre.yml`, `lint-web` | `python3 loop/app-data.py just lint-web` |
| `test-web-since` | `tools/e14/observe.py`, web lane in `check.yml` | `python3 loop/app-data.py python3 tools/chromium-faults/observe.py --log <log> -- just test-web-since <base> --shard=<N>/<total> --config <generated-config>` |
| `web-durations` | This document, Human commands | `just web-durations <main-check-run-id>` |
| `contracts` | `tools/contracts/fresh.py`, `main` | `just contracts` |
| `contracts-test` | `.github/workflows/check.yml`, C4 step in `rust 1` | `just contracts-test` |
| `contracts-fresh` | `justfile`, `test-rust` | `just contracts-fresh` |
| `packages` | `justfile`, `lint-web`, `test-web-since`, `capture` | `just packages typecheck`; `just packages test <args>` |
| `harness` | `.agents/data/harness.md`, Harness | `just harness <seed> <port>` |
| `harness-real` | `.agents/data/harness.md`, Harness (`harness-real` paragraph) | `just harness-real <project-path> <port>` |
| `build-debug` | `.github/workflows/check.yml`, A4691 step; `justfile`, `app` | `just build-debug` |
| `app` | This document, Human commands | `just app <project>` |
| `app-release` | This document, Human commands | `just app-release <project>` |
| `app-bundle` | `.github/workflows/check.yml`, S1 macOS App bundle | `just app-bundle` |
| `app-bundle-check` | `.github/workflows/check.yml`, S1 extracted App observer | `just app-bundle-check "target/$triple/release/bundle/macos/roundup.app"` |
| `icon` | `scenarios/app.md`, S12 | `just icon` after changing approved artwork |
| `perf` | `docs/perf.md`, Perf | `just perf` |
| `perf-keystroke` | `docs/perf-keystroke.md`, Native keystroke performance | `ROUNDUP_ALLOW_WINDOW=1 just perf-keystroke --out target/perf-keystroke-before.json` |
| `perf-frames` | `docs/motion-native-runbook.md`, Run | `ROUNDUP_ALLOW_WINDOW=1 just perf-frames <layers\|todos\|glyphs>` |
| `proofs-setup` | `justfile`, dependency of `proofs`; `check.yml`, Pinned Bend | `just proofs-setup` |
| `proofs` | `justfile`, `lint-rust` | `just proofs` |
| `capture` | `.agents/builder.md`, Code | `just capture <ids>` |
| `perf-idle` | `docs/perf.md`, R24 idle App observer | `ROUNDUP_ALLOW_WINDOW=1 just perf-idle --host target/perf-idle-host.json` |
| `migrations` | `justfile`, `ready` | `just migrations origin/main` |

## Retained root package scripts

| Script | Reachable caller | Invocation |
| --- | --- | --- |
| `lint` | `justfile`, `lint-web` → `pre.yml` | `pnpm lint` |
| `typecheck` | `justfile`, `lint-web` → `pre.yml` | `pnpm typecheck` |
| `slop` | `justfile`, `lint-web` → `pre.yml` | `pnpm slop` |
| `postinstall` | pnpm install lifecycle; `.github/actions/setup/action.yml` | `pnpm install --frozen-lockfile` automatically runs `postinstall` |
| `prepare` | pnpm install lifecycle; `.github/actions/setup/action.yml` | `pnpm install --frozen-lockfile` automatically runs `prepare` |
| `lint:styles` | `justfile`, `lint-web` → `pre.yml` | `pnpm lint:styles` |
| `lint:cycles` | `justfile`, `lint-web` → `pre.yml` | `pnpm lint:cycles` |

## Human commands

Run `just app <project>` for development or `just app-release <project>` to observe the embedded release webview without a dev server. Both open a native App; use the Mac where that observation is intended.

To refresh the existing web-shard timing data after a representative successful main check run, find its id with `gh run list --branch main --workflow check.yml`, then run `just web-durations <main-check-run-id>`. Review the resulting duration changes before committing.

For the cleanup's observers run `just lint-rust origin/main`, `just lint-web` and `just contracts-test`. The last command executes both C4 observers; a committed-tree freshness check alone does not replace them.

## Retired observers

T5464c retires Z4505's four fake-command tests, E7's three report-text/existence assertions and the four `docs/u478-*` files' documentation-only integration/contrast assertions. Z4505's recipe behavior remains policy in `scenarios/clippy-selection.md`; E7's real injection observation, report, script and stub remain in `scenarios/awareness.md` and `spikes/context-injection/`. Active token checks in the App and stylelint remain. No replacement source-text or fake-command test is added.

## T5464 observations, 2026-11-01

Executable head: `07df92b4a96096849d03952fd95510e809dfe7ed`; implementation base: `2b4d02ef2`. Observations used this Linux runner, the same installed pnpm dependencies and pinned lint/proof tools, and `origin/main` for both Rust lint invocations. The before pair restored the original commands; a comment-only justfile change selected the same all-crate Clippy path as the implementation. No install is included in the paired lint timings. The after commands run inside `just ready`, timed at its logged command boundaries; migrations and N7 are timed separately from the lint commands.

Caches remained installed across the pair. Concurrent C4 compilation and Cargo lock waiting affected the before run; the initial C4 probes accidentally shared target directories. The final contract recipe uses its intended separate directories. These are command-duration observations, not a speedup claim. The expanded pre call paths only remove commands: no new install, scan, test or command reaches either pre job. Web selection and the always-reached `lint` job are unchanged.

| Invocation | Exit | Seconds | Result/context |
| --- | ---: | ---: | --- |
| Before: `just lint-rust origin/main` | 0 | 243.99 | Retained commands; all-crate selection; includes Cargo lock contention |
| Before: `just lint-web` | 0 | 484.28 | Retained commands; installed dependency/tool caches |
| After: `just lint-rust origin/main` (in `ready`) | 0 | 72.74 | Final executable tree |
| After: `just lint-web` (in `ready`) | 0 | 323.10 | Final executable tree |
| `just ready` | 0 | 398.25 | Both lints, migrations and N7 |
| `just contracts-test` | 0 | 485.50 | Both named C4 observers; separate target directories |
| Spelling probe: `python3 tools/lint/scan.py web` | 1 | 44.45 | Expected spelling rejection at `README.md:13:4` |
| Spelling probe: `just lint-rust origin/main` | 1 | 46.56 | Expected spelling rejection through `lint-repo` |
| Spelling probe: `just lint-web` | 0 | 423.04 | No repo-wide scan or spelling diagnostic |
| Initial `just lint-rust origin/main` | 0 | 237.39 | Setup run; proof tools installed; excluded from comparison |
| Initial `just lint-web` | 1 | 427.72 | Invalid baseline: scripts changed during execution; missing-script exits 254; repeated above |
| Warmup: `just clippy origin/main` | 0 | 361.51 | Full all-target compiler cache warmup; excluded from comparison |
| `just clippy T5464-missing-base` | 1 | 0.21 | Expected failure with Git diagnostic; no compiler invocation |
| Initial `just contracts-test` | 1 | 192.05 | Stale fixture/module errors and shared-target interference; repeated above |
| First `python3 tools/contracts/test_addition.py` repair probe | 1 | 96.00 | Fixture constructor repaired; binary-unit helper imports still failed |
| Second `python3 tools/contracts/test_addition.py` repair probe | 1 | 477.01 | Shared Cargo target interference; excluded; final run uses separate targets |
| `python3 tools/contracts/test_fresh.py` diagnostic probe | 0 | 536.07 | Pass, including repeated generation and drift/failure cases; includes Cargo waiting |

Complete outputs and timing files are retained under `artifacts/ux/T5464a/validation/` in the run workspace, named `5464-<observation>.log` and `.time`. Failed probes are retained separately and are not clean results. The spelling fixture was restored; no probe declaration, handler or generated output is committed. No command timed out and no tool was unavailable; the invalid baseline's missing package scripts are recorded above.

The isolated planner observation changed one file at a time against `HEAD`, then restored it. Existing `loop/affected.py rust HEAD` returned no crates for each of `test_addition.py`, `test_fresh.py`, `fixtures/addition.rs` and `fresh.py` under `tools/contracts/`; the check workflow's Git-path condition selected Rust for each. Declaration and generator edits retained the existing dependent-crate selection; `justfile` and `check.yml` edits returned `all`. Only partition 1 invokes C4, and a failed C4 step fails `rust 1`, which is required by the aggregate `check` job. Nothing in pre invokes C4.

The unchanged L5398 boundary observer passed. `loop/rules.sh vocab` and `git diff --check origin/main` passed. Final `ready` also ran N7. The diff leaves active App token tests, stylelint, all scanner implementations, scanned paths, inventories and debt ratchets unchanged. There is no product behavior change and no new Principles Gate path; P4 and P9 vendor/launch boundaries remain unchanged.
