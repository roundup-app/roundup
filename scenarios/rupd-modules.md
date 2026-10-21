# Daemon module layout

Module: `crates/rupd`. Ids: RM1. Rule: `.claude/sound/placement/file-stays-under-a-size-cap.md`. Requested in #3208; the pre-commit size hook of #3210 waits on it.

**RM1 Every Daemon source file stays under 1000 lines.**

Given `crates/rupd/src/lib.rs` holds more than 1,000 lines, split it into sibling modules in `crates/rupd/src/`, one per responsibility, extending an existing module (`storage.rs`, `waits.rs`, `wake.rs` and the others there) before adding one. This is a refactor of existing machinery; it introduces no parser, protocol, store, library dependency or public name.

Then:

- **Layout (policy).** `lib.rs` keeps the module declarations and the public surface. Every `.rs` file under `crates/rupd/src/`, tests included, is under 1000 lines. Each new file is named for the concept it holds; no `part1`/`part2` name, no `utils`/`helpers` overflow file, no re-export stub at an old path, no raised cap, no skipped hook, no `include!` or external test file used to hide lines. Observer: `wc -l crates/rupd/src/*.rs`, each file's count recorded separately.
- **No change (policy).** Public items keep their Rust paths, visibility, types and behaviour; no caller edits outside `crates/rupd/src/`. Observer: `cargo doc -p rupd` public items and caller compilation compare equal with the base.
- **Reviewable moves (policy).** Each commit is one move, with only the imports, qualification and internal visibility needed to compile it; no behaviour change, test retirement or cleanup. Observer: `git show --color-moved` per commit.
- **Regression (policy).** Every `rupd` test that passed on `origin/main` passes unchanged under the same name; the full `cargo nextest run -p rupd` run is the observer, with no new test added to reread file layout.
- **Staging (policy).** The move may land as several PRs, each green and each naming `Refs #3208`; only the last, after which `wc -l` shows every file under 1000, says `Closes #3208`.

## Checks on main

1. `crates/rupd/src/lib.rs` holds the module declarations and the code being split.
2. `crates/rupd/src/storage.rs`, `crates/rupd/src/waits.rs` and `crates/rupd/src/wake.rs` are the existing responsibility modules to extend.
3. `.claude/sound/placement/file-stays-under-a-size-cap.md` states the cap.
