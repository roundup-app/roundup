# UI: each changed file carries a fingerprint of its To side (U7673a–U7673b)

Module: `crates/agents` and `crates/contracts`. Ids: U7673a, U7673b. Work order: [#7673](https://github.com/roundup-app/roundup/issues/7673), blocked by #7672. Owner, 2026-11-18: "prime our moat - simplicity, focus, clean, fast". Later work must tell that a file changed since the user saw it (#7675, #7680, #7691, #7704); a rewrite can keep the same counts, and git's blob id changes with any byte. Contract change (rule 4): each `ChangedFile` entry of `agent.changedFiles` and `agent.ownedChanges` gains `blob`, a string or `null`; every caller, `contracts/generated/` (regenerated, never hand-edited), `scenarios/rpc.md`, the **Changed file** row of `GLOSSARY.md`, the fake App and every `ChangedFile` literal in the App's tests and fixtures change in the implementation PR. No new Daemon method, no hashing in the App, no screen change. #7610's counts (U7610a, U7610b) stay as they are. The implementation PR's `Reuse:` section names git's own blob ids (`git hash-object`, the tree read) and no new library. Observer: Rust tests on Linux against real temporary git repositories; `just perf` (rule 7). Never a native Mac capture.

**U7673a every changed-file entry carries `blob`, git's blob id of the To side.** Given an Agent with its own Worktree (G2) and `to` of `tree` or `branch` (U7672a), or `agent.ownedChanges` (U7672b), then each entry is `{path, status, line, counts, blob}`:
- **Which id.** `blob` equals `git hash-object` of the To side's bytes: for Branch, the blob in HEAD's tree; for Tree and Changes, the working-tree file, an untracked file included; `null` for a deleted file. This holds for an added, a modified, a deleted, a binary, an untracked, a pure-renamed and an edited-renamed file, in each of Tree, Branch and Changes. Asserted in `u7673a_blob_equals_git_hash_object_for_every_file_state`.
- **Any byte.** A rewrite that keeps `counts` changes `blob`; an unchanged To side keeps it. Asserted in `u7673a_a_rewrite_that_keeps_the_counts_changes_the_blob`.
- **Counts kept.** For each `to` value `counts` still equals `git diff --numstat` (U7610a). Asserted in `u7673a_counts_still_equal_git_numstat`.

**U7673b the ids of a listing come from one hashing process.** Given a listing of 500 changed files whose To side is the working tree, then one `git hash-object --stdin-paths` call hashes every working-tree path, so the listing starts one hashing process, not one per file; the App reads no file to fingerprint it, and `agent.compareFile` stays the one read of a file's bytes, with its 4 MiB limit (U2540a). Asserted in `u7673b_five_hundred_files_start_one_hashing_process`.

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-changes-counts.md`, U7610a: the entry's `counts` and the one git call for a list.
2. `scenarios/ui-changes-remote-main.md`, U7672a and U7672b: the `to` values and the Changes target.
3. `scenarios/ui-worktree-changes.md`, U2539a: the entry's `status`, `line` and path order.
