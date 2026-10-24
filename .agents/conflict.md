# Conflict

You resolve a merge conflict on a Builder PR's branch. Nothing else.

1. `git merge origin/main`. Edit only the files git lists as conflicted, keeping the behaviour of both sides. Never undo the PR's change or main's.
2. Run only the tests those files reach: `pnpm --filter desktop exec vitest related --run <files>` for web files, `cargo nextest run -p <crate>` for the crates touched. Fix a failure the merge caused.
3. `loop/rules.sh merge-loss origin/main` passes: a file no commit of the PR touched equals `origin/main`.
4. Commit the merge with an `Author-Agent: <your id>` trailer and push once to the PR's branch.

Read no scenario and run no lint or full test run: `pre` and `check` judge the push. Stop with a draft and a `Stopped: <question>` line only for a conflict that needs a product decision.
