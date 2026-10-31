# Build diagnostics

Module: workspace and desktop dependency configuration. Ids: Z2, Z4280a, Z5211a.

**Z2 ts-rs emits no serde-attribute warnings.** Given the workspace uses ts-rs 12 and Rust contract types retain `#[serde(deny_unknown_fields)]`, when the Rust targets used by `just app` and CI are compiled from a fresh Cargo target directory, then:

- **Quiet builds (policy).** The workspace `ts-rs` dependency enables `no-serde-warnings`, retaining its default features and version requirement. Successful build output contains neither `warning: failed to parse serde attribute` nor `ts-rs failed to parse this attribute`. Observe with `cargo build -p rupd -p rup -p desktop` and `cargo clippy --all-targets -- -D warnings`, each using a fresh `CARGO_TARGET_DIR` and capturing stdout and stderr. Both commands exit 0 and both logs contain zero occurrences of either diagnostic. The Linux observer covers the shared dependency feature; no native window observation is required.
- **Identical generated types (policy).** After `cargo test -p contracts`, every tracked file under `contracts/generated/` is byte-for-byte equal to `origin/main`, with no added or removed files. Observe with Check 3 and `git diff --exit-code origin/main -- contracts/generated`; both exit 0. Regenerate from Rust; never edit generated files.
- **Deserialisation stays strict (policy).** No Rust serde attribute, contract type, caller, RPC method or generated TypeScript changes. The implementation diff changes only the workspace dependency's feature configuration; removing or changing `deny_unknown_fields`, disabling serde compatibility, changing versions or suppressing unrelated compiler warnings does not satisfy this scenario. Observe the diff against `origin/main`.

Checks already on main:

1. `justfile`, `app`: builds `rupd` and `rup`, then runs `desktop`.
2. `justfile`, `clippy`: compiles all workspace targets with warnings denied; `lint-rust` invokes it for CI.
3. `justfile`, `contracts-fresh`: rejects changed generated files and untracked generated files; `test-rust` invokes it after the Rust tests regenerate bindings (`crates/contracts/src/lib.rs`, crate documentation).

The upstream feature forwards to `ts-rs-macros/no-serde-warnings`: [ts-rs 12 feature documentation](https://docs.rs/crate/ts-rs/12.0.1/features#no-serde-warnings). This is build configuration only; it changes no product path governed by a Principles gate.

**Z4280a desktop builds use upstream global-hotkey without SUPER deprecation warnings.** Given the desktop crate and its Todo quick-add shortcut, when the vendored global-hotkey dependency is replaced, then:

- **Upstream dependency (policy).** Cargo resolves `global-hotkey` 0.9.0 from crates.io, using its upstream `keyboard-types ^0.8` dependency. Remove the `global-hotkey` entry from `[patch.crates-io]`, its workspace `exclude` entry and the whole `vendor/global-hotkey-0.8.0/` directory; regenerate `Cargo.lock`. Adapt dependency requirements and callers as needed without changing shortcut behavior. Observe the implementation diff and `cargo tree -p desktop -i global-hotkey`: the command exits 0 and reports upstream 0.9.0, with no vendored global-hotkey path. No warning suppression or replacement vendored copy satisfies this clause.
- **Quiet desktop build (policy).** On Linux and macOS, build `desktop` with a fresh `CARGO_TARGET_DIR`, capturing stdout and stderr: `cargo build --locked -p desktop`. Each command exits 0 and each log contains zero occurrences of `Modifiers::SUPER`. The macOS build must compile global-hotkey rather than reuse cached artifacts; Linux alone does not observe the shipped native shortcut dependency. Check 1 identifies the desktop build, and Check 2 retains the warnings-denied compile gate. This clause concerns global-hotkey deprecation diagnostics only; Z2 remains unchanged.
- **Quick add stays intact (policy).** Existing global-shortcut tests pass unchanged: Check 4 retains real OS registration of `Super+Shift+KeyT` (`⇧⌘T`), collision refusal preserving the old binding, replacement, invalid-input refusal and release; Check 5 retains one capture per press and shell-event registration/release; Check 6 retains refusal of a conflicting setting and reset to the default chord. Run the named tests through their existing desktop/native and web test runners; every invocation exits 0. Check 4 runs in the existing macOS CI lane, not a Chromium substitute or a new manual Mac prerequisite.

Checks already on main for Z4280a:

4. `crates/desktop/tests/capture_panel/mod.rs`, `u3787f_panel_does_not_activate_main_window`, asserts native shortcut registration, refusal, replacement and release. `crates/desktop/tests/s2297a.rs`, `main`, registers it in the main-thread harness; `.config/nextest.toml`, `profile.mac`, selects that binary for macOS CI.
5. `apps/desktop/src/keys/u3713_capture.test.tsx`, `u3787f_global_capture_uses_the_existing_owner_once_per_press` and `u3787f_global_capture_registers_and_releases_through_the_shell_event_adapter`, assert capture dispatch and shell-event listener lifetime.
6. `apps/desktop/src/settings/u3806_preferences.test.tsx`, `u3804_a_clashing_chord_is_refused_naming_the_holder` and `u3804_reset_restores_the_default`, assert shortcut-setting refusal and default restoration.

This dependency replacement adds no product behavior or editable surface; no Principles gate changes. The existing shortcut observers above cover the regression boundary.

**Z5211a the desktop Vite config loads without a native-loader warning.** Given `apps/desktop/vite.config.ts` and the modules it loads, directly or through imports (`budgets/build.ts`, `src/testing/realDaemonPlugin.ts`, `captures.ts`, `shardSequencer.ts` and what they reach, including `src/app/seam.ts`), when `vite` or `vitest` starts in `apps/desktop`, then:

- **Quiet start (policy).** Output contains neither `configLoader: 'native'` nor `without a file extension`. Observe with `pnpm --filter desktop exec vitest run <any test file>` (Check 1); it exits 0 with zero occurrences of either text. The Linux observer covers it; no native window observation is required.
- **Explicit extensions (policy).** Every relative import in that graph, `import type` included, ends in `.ts` or `.tsx`, the first fix being `src/app/seam.ts`'s `../perf/idle`. Observe the diff and the guard below.
- **Guard (policy).** The `lint-web` job fails on a relative import without an extension in the config graph: the oxlint `import/extensions` rule (`always`, `ignorePackages`), applied through an `.oxlintrc.json` override scoped to the graph's files, so no new script exists. It fails on `origin/main` before the fix, naming `src/app/seam.ts`, and passes after.
- **No behaviour change (policy).** The diff changes import specifiers and lint configuration only. Observe the diff against `origin/main`.

Checks already on main for Z5211a:

1. `apps/desktop/vite.config.ts`: the config every `vite` and `vitest` start loads; its start prints the warning today.

This is build tooling; it changes no product path governed by a Principles gate.
