# UI: Worktree-to-worktree counts come from one git call (U7620a)

Module: `crates/agents`. Id: U7620a. Work order: [#7620](https://github.com/roundup-app/roundup/issues/7620).

U7610a's one-pass rule holds for a comparison whose From and To are both worktrees: `agent.changedFiles` computed those counts with one `git diff --no-index` call for each file, which grows with the list. Observer: a Rust test on Linux against temporary git repositories. Never a native Mac capture.

**U7620a `agent.changedFiles` counts a worktree-to-worktree comparison in one git call.** Changes no contract and no Token. Given an Agent whose From and To are both worktrees and whose list holds many changed files, then:
- **Same counts.** For every listed file, `counts` equals the file's line counts between the two worktrees as git counts them (an added file counts all its lines as added, a removed file all as removed), and a binary file has `counts: null`. Asserted in `u7620a_worktree_pair_counts_equal_git_for_every_file_state`.
- **One pass.** The counts come from one git call for the whole list, never from a call for each file. Asserted in `u7620a_a_worktree_pair_is_counted_in_one_git_call`.

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-counts.md`, U7610a: the counts' shape and its one-pass rule.
2. `crates/agents/src/worktree/endpoints.rs`, `endpoint_counts` and `fallback_counts`: the code that counts a worktree pair file by file.
