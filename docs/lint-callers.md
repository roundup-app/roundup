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
| `harness-real` | `.agents/data/harness.md`, Real Daemon | `just harness-real <project-path> <port>` |
| `build-debug` | `.github/workflows/check.yml`, A4691 step; `justfile`, `app` | `just build-debug` |
| `app` | This document, Human commands | `just app <project>` |
| `app-release` | This document, Human commands | `just app-release <project>` |
| `app-bundle` | `.github/workflows/check.yml`, S1 macOS App bundle | `just app-bundle` |
| `app-bundle-check` | `.github/workflows/check.yml`, S1 extracted App observer | `just app-bundle-check "target/$triple/release/bundle/macos/roundup.app"` |
| `icon` | `scenarios/app.md`, S12 | `just icon` after changing approved artwork |
| `perf` | `docs/perf.md`, Budgets | `just perf` |
| `perf-keystroke` | `docs/perf-keystroke.md`, native run instructions | `ROUNDUP_ALLOW_WINDOW=1 just perf-keystroke --out target/perf-keystroke-before.json` |
| `perf-frames` | `docs/motion-native-runbook.md`, workloads | `ROUNDUP_ALLOW_WINDOW=1 just perf-frames <layers\|todos\|glyphs>` |
| `proofs-setup` | `justfile`, dependency of `proofs`; `check.yml`, Pinned Bend | `just proofs-setup` |
| `proofs` | `justfile`, `lint-rust` | `just proofs` |
| `capture` | `.agents/builder.md`, Code | `just capture <ids>` |
| `perf-idle` | `docs/perf.md`, R24 | `ROUNDUP_ALLOW_WINDOW=1 just perf-idle --host target/perf-idle-host.json` |
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
