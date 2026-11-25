# UI: The Changes list counts lines in the Daemon (U7610a–U7610c)

Module: `crates/agents` and `crates/contracts` (U7610a), `apps/desktop/src/changes/` (U7610b). Ids: U7610a, U7610b, U7610c. Work order: [#7610](https://github.com/roundup-app/roundup/issues/7610); U7610c: [#7874](https://github.com/roundup-app/roundup/issues/7874), blocked by #7678.

Opening Changes froze the App: each file row fetched both full versions through `agent.compareFile` and ran jsdiff's `diffLines` on the main thread, which takes 6.8 s for a 10,000-line rewrite. Contract change (rule 4): `agent.changedFiles` entries gain `counts`; every caller, `scenarios/rpc.md`, `GLOSSARY.md` and the fake App change in the implementation PR. The implementation PR's `Reuse:` section names the git CLI or library the Daemon counts with, as `agent.changedFiles` does. Observer: a Rust test on Linux against a temporary git repository for U7610a; Vitest against the fake App for U7610b. Never a native Mac capture.

**U7610a `agent.changedFiles` returns each file's line counts, as git counts them.** Adds a field to one Daemon method; changes no Token. Each entry of `files` is `{path, status, line, counts, blob}` (`blob`: U7673a, `scenarios/ui-changes-blob.md`), with `counts` as `{added, removed}` or `null`. Given an Agent and a Compare target `to` (`tree` or `branch`, U7672a; amended by U7672, the endpoints are retired), then:
- **Same as numstat.** For every listed file, `counts` equals `git diff --numstat` between the same two endpoints, whose worktree side includes staged, unstaged and untracked files (an untracked file counts all its lines as added), including a 10,000-line rewrite. Asserted in `u7610a_counts_equal_git_numstat_for_every_file_state`.
- **Binary and unreadable.** A binary file (numstat prints `-`) has `counts: null`. Asserted in `u7610a_a_binary_file_has_no_counts`.
- **One pass.** The counts come from one git call for the whole list, never from a call for each file, and no file text is read into the Daemon's reply. Asserted in `u7610a_the_counts_come_from_one_git_call_for_the_list`.

**U7610b the Changes list shows the Daemon's counts and neither fetches nor diffs file text.** Given the open Changes view, then:
- **Counts shown.** Each file row shows `+added -removed` from its entry's `counts`, and none when `counts` is `null`. Asserted in `u7610b_rows_show_the_daemon_counts_and_a_binary_file_shows_none`.
- **No text in the list.** Opening the list calls `agent.changedFiles` once and `agent.compareFile` only for the first file in tree order (U7674a, which amends "zero times"); every other file's `agent.compareFile` waits for the user to choose it, and the App imports no line-diff library for the list. Asserted in `u7610b_opening_the_list_never_calls_compare_file`.
- **Responsive.** Opening Changes for an Agent whose list holds a 10,000-line rewrite (the `u2540.html?dense` seed) runs no main-thread task over 200 ms, in Chromium and in WebKit. Asserted in `u7610b_a_ten_thousand_line_rewrite_keeps_the_page_responsive`.

**U7610c the open draws a 10,000-line rewrite in tasks under 200 ms.** `apps/desktop/src/changes/`, no contract, no Token. U7610b's Responsive clause failed on CI (WebKit most often, Chromium too) because the open also draws the first module's 20,000-line diff in one task. Given the `u2540.html?dense` seed, then:
- **No long task.** Opening Changes runs no main-thread task of 200 ms or more on CI, in Chromium and in WebKit: the open yields between tasks or draws only the lines in view, through what the diff library the reader already uses offers before any new code (rule 9). Asserted by `u7610b_a_ten_thousand_line_rewrite_keeps_the_page_responsive`, unchanged: its 200 ms limit and its seed stay.
- **Same screen.** The first screen of the open module shows the same rows and the same `+added -removed` counts as before, and every U7678 and U2540 test passes unedited. Asserted by those tests.
- **Measured.** The implementation PR's body gives the longest block WebKit measured on its own check run, before and after. Policy.

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/ui-worktree-changes.md`, U2539a: `agent.changedFiles`' base, status and line rules.
2. `scenarios/ui-agent-changes.md`, U7186b and U7186c: the endpoints and the `+added -removed` counts this keeps.
3. `apps/desktop/src/changes/ChangesView.tsx`, `countsOf`: the code this removes.
