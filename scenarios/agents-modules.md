# Agent module ownership

**AM1 Agent responsibilities own their implementation and private state.**

Given the `agents` crate after the Agent store (#1617) and Worktree removal
implementation (#1635), reorganise `crates/agents/src/lib.rs` without changing
behaviour or its public Rust interface. This is a refactor of existing machinery;
it introduces no parser, protocol, store, library dependency or public name.

Then:

- **Layout (policy).** `lib.rs` contains the public surface and module declarations,
  with fewer than 1,000 lines. Move implementation into private sibling modules
  organised around spawn, Door, Rail, Resume, store wiring and events. A
  responsibility may use multiple modules to meet the limit; every new Rust file
  has at most 800 lines, including comments, blank lines and inline tests. Do not
  move implementation into `include!` files or external test files to hide it from
  this count. Observer: `wc -l crates/agents/src/*.rs`, plus the diff's list of new
  files; count each new Rust file even if it is in a subdirectory.
- **State ownership (policy).** For each state field, list the production modules
  that read it and the functions performing those reads. A read inspects the
  value to make a decision or produce a result; construction, forwarding a
  reference and a test's inspection do not count. State read by exactly one
  module lives in a type defined in that module, held by `Shared`. Each remaining
  ungrouped field on `Shared` has readers in at least two production modules.
  A module-owned holder on `Shared` is exempt from the two-reader requirement:
  its contained fields must satisfy the one-owner rule. Delegating through an
  accessor does not turn the accessor's module into a second consumer. Observer:
  a field-to-reader table in the implementation PR, checked against the code.
- **Interface and scope (policy).** Keep every public item accessible at its
  existing Rust path, with its existing visibility, types and behaviour. Do not
  require caller edits. Own only `crates/agents/src/lib.rs` and new modules beside
  it; leave `crates/agents/src/worktree.rs`, contracts and existing tests unchanged.
  Observer: compare the public declarations and caller compilation with the
  base, and inspect `git diff --name-status origin/main`.
- **Reviewable moves (policy).** Each implementation commit performs code moves
  or field regrouping, with only the imports, qualification and internal
  visibility adjustments needed to compile them. No new behaviour, test
  retirement or unrelated cleanup. Observer: review each commit separately,
  using `git show --color-moved` for moves.
- **Regression.** Every pre-existing `agents` test passes unchanged, including
  the crate's unit, integration and documentation tests. Run `cargo test -p
  agents` and `just check origin/main`; preserve the existing scenario assertions,
  rather than adding tests that reread module layout. Existing assertions include
  `a6_move_reorders_and_keeps_orders_contiguous_from_zero` and
  `a8_workstreams_names_parents_and_order_survive_reopening` in
  `crates/agents/tests/scenarios/rail.rs`. The full crate run, not those examples
  alone, is the regression observer.

## Checks on main

1. `crates/agents/src/lib.rs`, `Shared`, holds the state being regrouped;
   `Agents` holds the public entry points being preserved.
2. `crates/agents/tests/scenarios/rail.rs`,
   `a6_move_reorders_and_keeps_orders_contiguous_from_zero`, asserts A6's Rail
   ordering; `a8_workstreams_names_parents_and_order_survive_reopening` asserts
   A8's durable Rail data.
3. `justfile`, `check` and `test-rust-since`, define the required check and its
   affected-crate selection. The explicit full-crate regression run above also
   covers tests outside that selection.

## Observer results

The implementation PR records one row per command with its exit code and any
failure, and includes the line counts and state-reader table. A nonzero command
or a violated policy clause fails AM1. The specification PR establishes this
acceptance only; it does not claim the refactor or the size guard is delivered.
