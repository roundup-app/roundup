# Workspace

Module: root files. Ids: W1, W2889.

Root files: `Cargo.toml`, `package.json`, `justfile`, `.fallowrc.json`. The App crate needs no root change, because `crates/*` already holds it. The webview needs none either, because `pnpm-workspace.yaml` already lists `apps/*`. What the root does lack is a check that covers webview packages.

**W1 the check covers the App.** Given a pnpm package under `apps/` or `ext/` with `typecheck` and `test` scripts, when `just check` runs, then it typechecks and tests that package (`pnpm -r --if-present`), and Oxlint and fallow cover it with no per-package root edit. `just app <project>` builds `rupd` and `rup`, starts the webview's dev server, waits for it to answer, and runs the App (`cargo run -p desktop -- <project>`). `just app-release <project>` builds the webview's files and the App, `rupd` and `rup` in release mode, then runs the App on those built files with no dev server. It does not bundle, sign or notarize. The MVP gate measures cold start on it. With no package under `apps/`, as on today's main, `just check` still passes.

This is config, so W1 is the one scenario proven by an observer instead of a test named `w1_…` (see `README.md`). The observer has two parts. First, `just check` passes on the PR. Second, on a scratch branch with a throwaway `apps/probe` package (Vite, Solid, Vitest) whose one test fails, `just check` fails on that test, and `pnpm slop` does not report the probe's entry files as unused. Do not commit the probe. If fallow needs a root entry glob to find `apps/*` entry files, W1 adds it here, so later webview PRs never touch the root.


**W2889 Vite configuration loads natively without warnings.** Given the installed workspace dependencies and a Node version supported by the pinned Vite release, when Vite loads `apps/desktop/vite.config.ts` with `configLoader: "native"`, then loading succeeds and returns the desktop configuration. Planned test: `w2889_native_config_loads` in `apps/desktop/reporting/config.test.mjs`, using Vite's real configuration-loading API rather than a stub or a source-text assertion.

**Implementation constraints (policy).** The two local imports in `apps/desktop/vite.config.ts` name `./src/testing/realDaemonPlugin.ts` and `./src/testing/shardSequencer.ts` explicitly. If TypeScript requires it, enable `allowImportingTsExtensions` in `apps/desktop/tsconfig.json`; Check 1 passes. Do not set `VITE_CONFIG_NATIVE_IGNORE_WARNING` in code, commands or the observation environment. Keep the existing real-Daemon plugin and shard sequencer behavior.

**Startup observer (policy).** With `VITE_CONFIG_NATIVE_IGNORE_WARNING` unset, capture stdout, stderr and exit status for the normal desktop `vite` startup, a `vitest` invocation that loads this configuration, and the Vite dev-server command used by `just app` (Check 2). Each loads the configuration without the unsupported-native-config-loader warning; the dev server answers HTTP before it is stopped. On Linux the exact dev-server command is sufficient: no native App window observation is needed for this configuration-only change. Also record the native-loader test result and Check 1. Record each failure as a separate row with command, diagnostic and exit code; a timeout or forced shutdown before readiness is a failure, not a successful startup. A deliberate shutdown after readiness is recorded separately from startup success.

**Regression checks on main.**

1. `justfile`, recipe `lint-web`: web linting and TypeScript accept the explicit TypeScript import extensions.
2. `justfile`, recipe `app`: the existing App launch continues to use the desktop Vite dev server; this scenario changes neither native App behavior nor the launch sequence.
