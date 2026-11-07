# The Feedback report's debug facts are true for the running App (FB7 to FB9)

Module: `crates/desktop`. Ids: FB7, FB8, FB9. Acceptance for [#6639](https://github.com/roundup-app/roundup/issues/6639); amends FB3 of `scenarios/feedback-report.md`. Decided by the owner (2026-11-07): every report on #6163 named build `a7a2361b3114` though the App was rebuilt from `0baef3ab2`, its App log ended on 2026-11-04 and its Daemon log was empty.

**FB7 the build id is the commit the App was built from.** Given a new commit and a rebuild of `crates/desktop`, then the stamped `ROUNDUP_COMMIT` equals `git rev-parse --short=12 HEAD`, in a checkout and in a git worktree. The build script reruns when HEAD or the ref HEAD names moves, and on no other git change; outside a git checkout it builds and stamps an empty commit. Tests: `fb7_the_stamp_follows_head_after_a_commit` (`crates/desktop`, a temporary repository and worktree, the build script's stamp function run before and after a commit), `fb7_no_git_checkout_stamps_empty_and_builds`, `fb7_rerun_paths_are_the_resolved_head_and_its_ref` (the paths the script emits as `rerun-if-changed` for a checkout and for a worktree).

**FB8 the App log holds this run's lines.** Given the App started and logged, when the form is built, then the App log section holds the last 200 lines of the log file this run writes, ending with a line stamped after the start of this run. Tests: `fb8_the_app_log_ends_with_this_runs_lines` (`crates/desktop`, a fake log directory holding an old file and this run's file).

**FB9 the Daemon log holds the Daemon's recent lines.** Given the Daemon running and writing to stderr, when the form is built, then the Daemon log section holds its last 200 lines, not empty, redacted as FB3 says. Tests: `fb9_the_daemon_log_holds_its_recent_stderr_lines` (`crates/desktop`, a fake Daemon writing marker lines to stderr).

**Observer.** Commit, run `just app .`, send a Feedback report: its build id equals `git rev-parse --short=12 HEAD` and both logs hold lines from this run; repeat from a git worktree. Linux CI runs the tests above with no display.

Policy, Must not: rebuild the crate on every build; fail to build outside a git checkout.
