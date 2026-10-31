# Split Rail.tsx by concept

Module: `apps/desktop/src/rail`. Source: #5381. Ids: T5381. Rule: `.claude/sound/placement/file-stays-under-a-size-cap.md`.

**T5381 Rail.tsx has room for the next Rail features.** Given `apps/desktop/src/rail/Rail.tsx` holds 1000 lines, the cap of the size lint, when its parts move into modules beside it, then:

- `Rail.tsx` is under 800 lines and every file the PR adds is under 1000, shown by `wc -l` on the files in the PR (policy).
- Each part goes first into a module that already exists there (`rows.ts`, `layout.ts`, `menu/model.ts`) when it belongs to that module's concept; a new module is named for what it holds. No `part1`/`part2` name, no `utils`/`helpers` file for overflow, no re-export stub at the old path, no raised cap and no skipped hook (policy).
- `Rail.tsx` keeps the `Rail` component and its public surface; no export, prop, RPC call or rendered output changes, and every importer of `Rail.tsx` is untouched (policy).
- Moves only: no function body changes except an `import`/`export` line. Each commit is one move a reviewer can follow with `git diff --color-moved` (policy).
- Every test that passed before passes after unchanged, with the same names; the web tests of `apps/desktop` pass (test: the existing tests under `apps/desktop/src/rail/`).

Observer: `wc -l` on the resulting files and `pnpm --filter desktop exec vitest run` passing; this specification adds no test that rereads file sizes (policy).
