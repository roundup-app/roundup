# Clippy selection

Module: `justfile`, recipe `clippy`. Id: Z4505.

**Z4505 clippy distinguishes selection failure from no Rust changes.** Given the real `just clippy <base>` recipe, observe its exit status, stdout, stderr and Cargo invocations:

- **Selection failure.** When `python3 loop/affected.py rust <base>` exits nonzero, with empty or nonempty stdout, then the recipe exits nonzero, retains the selector's stderr diagnostic, invokes no `cargo clippy` and prints no successful-skip message. Asserted by `z4505_selection_failure_fails_the_recipe` in `tools/clippy/selection.test.py`.
- **Empty selection.** When the selector exits 0 with empty stdout, then the recipe exits 0, reports that clippy was skipped because no Rust crate reaches the diff, and invokes no `cargo clippy`. Asserted by `z4505_empty_selection_skips_clippy` in `tools/clippy/selection.test.py`.
- **Rust selection.** When the selector exits 0 with a crate name or `all`, then the recipe invokes `cargo clippy --all-targets -- -D warnings` exactly once and succeeds only when that invocation succeeds. Asserted by `z4505_rust_selection_runs_clippy` in `tools/clippy/selection.test.py`, covering successful and failed Cargo exits.
- **No base.** When `just clippy` runs without a base, then it never invokes the selector, invokes the same Cargo command exactly once and succeeds only when Cargo succeeds. Asserted by `z4505_without_a_base_runs_clippy` in `tools/clippy/selection.test.py`, covering successful and failed Cargo exits.

Implementation boundary (policy): capture the selector's output in a standalone assignment under `set -euo pipefail`, before testing whether that output is empty. Do not run selection when no base is supplied. Keep the all-targets and warnings-denied arguments and the existing successful-skip behavior. Change only `justfile` and `tools/clippy/selection.test.py`; register the regression command in `lint-rust` so the existing lint gate runs it. Do not change the selector, workflows or loop policy.

Observer: execute the repository's real recipe with isolated command stand-ins controlling selector output/status and recording Cargo arguments and calls. The shell process is required: this regression concerns Bash's exit handling inside a command substitution in a conditional, which a text assertion or a Python-only model does not exercise. Start no compiler, browser, Daemon or vendor program. Use Python's standard-library test runner and temporary-directory/process facilities; add no dependency or recipe parser (policy).

Run `python3 tools/clippy/selection.test.py`; exit 0 means every clause passes. Record each failed invocation separately with its exit code and diagnostic; missing or failed observations are not passes (policy).

Checks already on main:

1. `justfile`, `clippy`: selects Rust changes when a base is supplied and invokes all-target Clippy with warnings denied.
2. `justfile`, `lint-rust`: invokes `clippy` with its base; `ready` invokes `lint-rust origin/main`.
3. `loop/affected.py`, `main` and `workspace`: a successful empty selection prints no crate names; a failed Git or Cargo subprocess exits nonzero.

No product path changes, so no Principles gate moves. The observer is a local shell command and requires no Mac-only observation (policy).
