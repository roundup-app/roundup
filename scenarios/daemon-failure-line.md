# A Daemon start failure names its cause on the first line (S6123)

Module: `crates/desktop`. Ids: S6123a–S6123b. Work order: #6123. Extends S5810a; adds no contract, RPC method, Token or change to how or when rupd starts.

**S6123a the first line names the cause.** Given a Daemon start that fails, when `crates/desktop/src/daemon.rs` formats the error, then its first line leads with rupd's last stderr line when the tail holds one (for example `rupd: refusing to start: …: Local data is incompatible with this build.`), followed by the exit status or other failure; when the tail is empty the first line names the failure alone, with no "stderr lines" wording. The whole tail follows on the lines after the first, unchanged in content. Asserted by planned unit test `s6123a_first_line_leads_with_the_last_stderr_line` in `crates/desktop/src/daemon.rs`: a tail ending in a refusal line gives a first line holding that refusal and the exit status; an empty tail gives a first line holding the exit status and not "stderr lines"; the full tail is in the text.

**S6123b a real refusal shows its cause in the first line.** Given a `project.db` in a temp data folder that real rupd refuses, when the App's Daemon launcher opens that Project, then the first line of the returned error holds `Local data is incompatible with this build.`. Asserted by planned test `s6123b_refused_project_first_line_holds_the_refusal` in `crates/desktop/tests/project_opening/mod.rs`, using real rupd on incompatible isolated data. Policy: the full text stays in `shell.log` as S5810a requires.

## Checks on main

1. `crates/desktop/tests/app.rs`, `s1_started_as_roundup_project_opens_that_project`: a successful start is unchanged.
2. `scenarios/app-startup-failures.md`, heading **S5810a a refused startup Project explains itself**: the refusal text still reaches the user and log.
