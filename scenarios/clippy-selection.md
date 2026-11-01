# Clippy selection

Module: `justfile`, recipe `clippy`. Id: Z4505.

**Z4505 clippy distinguishes selection failure from no Rust changes.** Given the real `just clippy <base>` recipe, observe its exit status, stdout, stderr and Cargo invocations:

- **Selection failure.** When `python3 loop/affected.py rust <base>` exits nonzero, with empty or nonempty stdout, then the recipe exits nonzero, retains the selector's stderr diagnostic, invokes no `cargo clippy` and prints no successful-skip message (policy).
- **Empty selection.** When the selector exits 0 with empty stdout, then the recipe exits 0, reports that clippy was skipped because no Rust crate reaches the diff, and invokes no `cargo clippy` (policy).
- **Rust selection.** When the selector exits 0 with a crate name or `all`, then the recipe invokes `cargo clippy --all-targets -- -D warnings` exactly once and succeeds only when that invocation succeeds (policy).
- **No base.** When `just clippy` runs without a base, then it never invokes the selector, invokes the same Cargo command exactly once and succeeds only when Cargo succeeds (policy).

Implementation boundary (policy): capture the selector's output in a standalone assignment under `set -euo pipefail`, before testing whether that output is empty. Do not run selection when no base is supplied. Keep the all-targets and warnings-denied arguments and the existing successful-skip behavior. Do not change the selector, workflows or loop policy.

T5464c retires the four automated stand-in test obligations and their `lint-rust` registration. These behaviors remain policy, observed through ordinary real-tool lint runs and review of the recipe; no replacement fake-command or recipe-text test is required.

Checks already on main:

1. `justfile`, `clippy`: selects Rust changes when a base is supplied and invokes all-target Clippy with warnings denied.
2. `justfile`, `lint-rust`: invokes `clippy` with its base; `ready` invokes `lint-rust origin/main`.
3. `loop/affected.py`, `main` and `workspace`: a successful empty selection prints no crate names; a failed Git or Cargo subprocess exits nonzero.

No product path changes, so no Principles gate moves. The observer is a local shell command and requires no Mac-only observation (policy).
