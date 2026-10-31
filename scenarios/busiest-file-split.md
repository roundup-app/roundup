# Split the eight busiest files by concept

Module: `apps/desktop/src/todos`, `apps/desktop/src/bubbles`, `crates/rupd`, `crates/terminal`, `crates/agents`. Source: #5402. Ids: T5402. Rule: `.claude/sound/placement/file-stays-under-a-size-cap.md`.

**T5402 The eight busiest files have room for the next features.** Given `apps/desktop/src/todos/Todos.tsx`, `apps/desktop/src/bubbles/Bubbles.tsx`, `crates/rupd/src/storage_tests.rs`, `crates/terminal/src/lib.rs`, `crates/agents/src/rail_view.rs`, `crates/rupd/src/reaction_checks.rs`, `crates/agents/src/rail.rs` and `crates/agents/tests/scenarios/resume.rs` each hold between 977 and 1000 lines, the cap of the size lint, when their parts move into modules beside them, then:

- Each of the eight files is under 900 lines and every file the PR adds is under 1000, shown by `wc -l` on the files in the PR (policy).
- Each part goes first into a module that already exists in the same directory when it belongs to that module's concept; a new module is named for what it holds. No `part1`/`part2` name, no `utils`/`helpers` file for overflow, no re-export stub at an old path, no raised cap, no skipped hook and no `debt.json` exception (policy).
- Each original file keeps its public surface; no export, prop, RPC call, public item or rendered output changes, and every importer of the eight files is untouched (policy).
- Moves only: no function body changes except an `import`/`export`/`use`/visibility line. Each commit is one move a reviewer can follow with `git diff --color-moved` (policy).
- Every test that passed before passes after unchanged, with the same names; the web tests of `apps/desktop` and the rust tests of `rupd`, `terminal` and `agents` pass (test: the existing tests under `apps/desktop/src/todos/`, `apps/desktop/src/bubbles/`, `crates/rupd/`, `crates/terminal/` and `crates/agents/`).
- One PR holds all eight splits; no partial PR (policy).

Observer: `wc -l` on the resulting files, `pnpm --filter desktop exec vitest run` and `cargo nextest run -p rupd -p terminal -p agents` passing; this specification adds no test that rereads file sizes (policy).
