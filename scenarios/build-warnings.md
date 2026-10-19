# Build diagnostics

Module: `Cargo.toml`. Ids: Z2.

**Z2 ts-rs emits no serde-attribute warnings.** Given the workspace uses ts-rs 12 and Rust contract types retain `#[serde(deny_unknown_fields)]`, when the Rust targets used by `just app` and CI are compiled from a fresh Cargo target directory, then:

- **Quiet builds (policy).** The workspace `ts-rs` dependency enables `no-serde-warnings`, retaining its default features and version requirement. Successful build output contains neither `warning: failed to parse serde attribute` nor `ts-rs failed to parse this attribute`. Observe with `cargo build -p rupd -p rup -p desktop` and `cargo clippy --all-targets -- -D warnings`, each using a fresh `CARGO_TARGET_DIR` and capturing stdout and stderr. Both commands exit 0 and both logs contain zero occurrences of either diagnostic. The Linux observer covers the shared dependency feature; no native window observation is required.
- **Identical generated types (policy).** After `cargo test -p contracts`, every tracked file under `contracts/generated/` is byte-for-byte equal to `origin/main`, with no added or removed files. Observe with Check 3 and `git diff --exit-code origin/main -- contracts/generated`; both exit 0. Regenerate from Rust; never edit generated files.
- **Deserialisation stays strict (policy).** No Rust serde attribute, contract type, caller, RPC method or generated TypeScript changes. The implementation diff changes only the workspace dependency's feature configuration; removing or changing `deny_unknown_fields`, disabling serde compatibility, changing versions or suppressing unrelated compiler warnings does not satisfy this scenario. Observe the diff against `origin/main`.

Checks already on main:

1. `justfile`, `app`: builds `rupd` and `rup`, then runs `desktop`.
2. `justfile`, `clippy`: compiles all workspace targets with warnings denied; `lint-rust` invokes it for CI.
3. `justfile`, `contracts-fresh`: rejects changed generated files and untracked generated files; `test-rust` invokes it after the Rust tests regenerate bindings (`crates/contracts/src/lib.rs`, crate documentation).

The upstream feature forwards to `ts-rs-macros/no-serde-warnings`: [ts-rs 12 feature documentation](https://docs.rs/crate/ts-rs/12.0.1/features#no-serde-warnings). This is build configuration only; it changes no product path governed by a Principles gate.
