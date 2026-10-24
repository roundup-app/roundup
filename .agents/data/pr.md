# PR

Data for Builder runs: a build or fix run writing a PR.

## Title and body

- The title starts with the Issue's scenario ids. The loop writes `Refs #<issue>` and `Scenarios: <ids>` after every run (L82), so write neither; write `Closes #<issue>` only for fully delivered acceptance.
- A `Principles: <ids>` line only when a `PRINCIPLES.md` id applies.
- `Reuse:` section (rule 9), required when the diff adds a file under `crates/*/src/`, `apps/desktop/src/` or `loop/`, or adds rule 9 machinery to an existing file; name candidates, the installed dependency or platform feature checked first, and the selection/rejection evidence.
- `Moves: D<n>, …` for a change under `apps/desktop/src` (rule 8).
- `Stopped: <the question>` on a draft its Builder leaves on a question only the user can answer; the end of its run screens it like an `ask` (L79, L81).
- Then only what a reader needs and CI does not show: no Shape, Proof, labels, history or boilerplate.

## Commits and branches

- Every authored commit carries `Author-Agent: <id>` (`human-saad` for the user's own) in its final trailer block, with no blank line before `Co-Authored-By` or another trailer; a clean merge of `main` needs none (L54), and a Copilot Autofix accepted on GitHub is authored by `copilot` (L37).
- A Builder's branch is `build/<key>`, named by its Issue; fix runs push to it. Historical spec-only PRs do not mark implementation done (L23).
- Issues merge in their native blocked-by dependency order. A stacked PR (its scenario says "after X" or "may stack") branches from its base, touches no file the base touches, and merges after it.
- Behind `main`: merge `origin/main` in (a stacked branch merges its base first), the lints and your files' tests as `.agents/builder.md` says, push; never rebase a branch with a review in flight.
- Lockfile conflict: take main's file and regenerate (`git checkout origin/main -- Cargo.lock && cargo update -w`; `git checkout origin/main -- pnpm-lock.yaml && pnpm install`), committed with the merge.
- A row needing `contracts/`, `GLOSSARY.md` or the App seam changes them in its own PR, by the Contract recipe of `.agents/builder.md`.

## Audit PR

Every scenario id has a test prefixed with its lowercase id (`L` ids: `L<n>` in `loop/*.test.sh`), except W1 (`just check`) and F1, F7 (spike records). An audit adds one test per clause no test asserts, with an id, clause, test table in the PR; it changes no scenario or behaviour and creates or updates a work Issue for each unmet clause. When merged PRs already assert every clause, of an audit or any other Issue, the PR is one empty commit with `Closes #<issue>` and that table.
