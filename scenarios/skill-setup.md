# Skill setup for outside agents

Module: `crates/agents` (`src/claude_code/`: SK1–SK6), `crates/rup` (SK7–SK9; `crates/terminal` for SK7's marker) and `apps/desktop` (`settings/`) with `crates/rupd` and `crates/contracts` (SK10–SK11). Ids: SK1–SK11. Work order: [#5251](https://github.com/roundup-app/roundup/issues/5251); implementation Issues #5252 (SK1–SK6), #5253 (SK7–SK9), #5254 (SK10–SK11), in that order. Principles served: P4, P9 (`PRINCIPLES.md`). Merging this specification delivers no runtime change.

Outside evidence: Rex, Superlogical's Mac terminal multiplexer (https://www.superlogical.com/rex/docs/llms-full.txt). `rex skill setup` installs a skill that teaches its commands and reads its guide from the installed binary, plus a session-start hook; it keeps the rest of the settings file, reports `unchanged` on a rerun, follows `CLAUDE_CONFIG_DIR`, refuses a skill of that name it did not install without `--force`, and its `status` and `remove` report and take out only its own items. roundup takes the same shape.

**Terms.** The **config folder** is `$CLAUDE_CONFIG_DIR` when set and non-empty, else `~/.claude`. An **outside session** is a Claude Code the user starts in any terminal, roundup's Terminals included, not one roundup launched as an Agent (no `ROUNDUP_AGENT`). Setup writes two **items** in the config folder:

- the **skill**: `skills/roundup/SKILL.md`. It says when to use `rup`, tells the session to run `rup help` for the commands and holds no copy of them, so it cannot go stale; its front matter carries `roundup-skill: <n>`, the owner mark and version;
- the **hook**: entries in `settings.json` under `hooks`, for the events of SK7, each a command that starts with the absolute path of the `rup` that wrote it followed by `skill report`. That prefix is the owner mark of a hook entry.

Every vendor string (folder, file, event and field names) stays in `crates/agents/src/claude_code/` (P4): `crates/rup` and `crates/rupd` see the Adapter's `Install`, `Plan` and `ItemState` types and no vendor word (`loop/rules.sh vocab`). Other vendors report `unsupported` until an Adapter adds them.

**SK1 setup installs the skill and the hook.** Given a config folder with no roundup item, when the Adapter sets up, then:

1. `skills/roundup/SKILL.md` exists with the owner mark and the version this build carries, and every folder on its path is created;
2. `settings.json` holds one hook entry per event of SK7, each marked as the hook; a missing `settings.json` is created, a missing `hooks` key or event list is added;
3. each item's outcome is `installed`;
4. each write is atomic (a temporary file in the same folder, then a rename), a `settings.json` that is a symbolic link is written through to its target and stays a link, and a failed write leaves the earlier file as it was.

Tests (`sk1_`, Rust, `crates/agents/tests/`, a temporary config folder): `sk1_setup_writes_the_skill_and_one_hook_per_event`, `sk1_a_missing_settings_file_and_folders_are_created`, `sk1_a_symlinked_settings_file_stays_a_link`, `sk1_a_failed_write_leaves_the_earlier_file`. Observer: the Rust tests.

**SK2 the user's settings stay theirs, and a rerun changes nothing.** Given a `settings.json` that holds other keys, other hooks (also on the same events), unknown fields and 2-space indentation, when the Adapter sets up and then removes (SK5), then:

1. after setup every other key, value, hook and their order is as before, and only roundup's entries were added, after the user's own on an event;
2. after setup and remove the file is byte-identical to the original when the original used 2-space JSON with a final newline, and equal as a JSON value (keys, order, values) otherwise; an event list or `hooks` key that setup added and remove emptied is removed again, and an emptied file stays as `{}` (remove never deletes `settings.json`);
3. a second setup writes nothing (both files keep their modification time and bytes) and reports `unchanged` for each item;
4. a `settings.json` that is not valid JSON, or whose top level, `hooks` or an event list has the wrong type, is left untouched and the item is `unreadable` (SK4), never repaired or replaced.

Tests: `sk2_other_settings_hooks_and_order_survive_setup`, `sk2_setup_then_remove_restores_the_bytes`, `sk2_a_rerun_writes_nothing_and_says_unchanged`, `sk2_an_unreadable_settings_file_is_never_rewritten`. Observer: the Rust tests, with a fixture holding the user's own hook on `Stop`.

**SK3 the config folder, and a foreign skill.** Given `CLAUDE_CONFIG_DIR` set to a folder, when the Adapter sets up, then it writes there and nowhere under `~/.claude`; with it unset or empty it writes under `~/.claude`. Given `skills/roundup/` already exists without the owner mark, then setup writes neither the skill nor the hook, reports the skill `foreign` and exits as a failure (SK9) with the fix in its text (remove that folder, or pass `--force`); with `--force` it replaces the folder's `SKILL.md` and reports `updated`. The owner mark is the only test of ownership: a folder with the mark and edited content is roundup's and is `outdated`. Tests: `sk3_the_config_folder_follows_the_variable`, `sk3_a_foreign_skill_is_refused_and_nothing_is_written`, `sk3_force_replaces_a_foreign_skill`. Observer: the Rust tests with the variable set, empty and unset (the test sets `HOME`, never the user's).

**SK4 status says what is installed.** Given any config folder, when the Adapter reports, then each item (`skill`, `hook`) is exactly one of:

- `current`: it exists, carries this build's version, and the hook entries are the ones setup would write now (command prefix included, so a moved `rup` makes them `outdated`);
- `outdated`: it is roundup's (owner mark) and differs from what setup would write;
- `missing`: absent; a partly present hook (some events only) is `outdated`, not `missing`;
- `foreign`: `skills/roundup/` exists without the owner mark;
- `unreadable`: the file or folder exists and cannot be read or parsed (permission, invalid JSON, wrong types);
- `unsupported`: no Claude Code is found (the config folder does not exist and no `claude` is on `PATH`); then setup and remove write nothing.

Reporting writes nothing and reads nothing outside the config folder. Tests: `sk4_each_state_is_reported_for_each_item`, `sk4_a_moved_rup_makes_the_hook_outdated`, `sk4_no_claude_reports_unsupported_and_setup_writes_nothing`. Observer: the Rust tests, one fixture per state.

**SK5 remove takes out only what roundup installed.** Given the items of SK1 beside the user's own, when the Adapter removes, then it deletes `skills/roundup/` only when it carries the owner mark, and deletes from `settings.json` only the hook entries marked as the hook (other entries of the same event stay), each item `removed`; a `foreign` skill is left and reported `foreign`; an item `missing` is reported `missing` and is no failure; a rerun changes nothing. Remove deletes nothing else in `skills/` and no sibling file in `skills/roundup/` it did not write: a folder with extra files keeps them, and only `SKILL.md` goes (the folder goes when empty). Tests: `sk5_remove_takes_only_marked_items`, `sk5_a_foreign_skill_and_the_users_hooks_stay`, `sk5_extra_files_in_the_skill_folder_stay`, `sk5_a_second_remove_changes_nothing`. Observer: the Rust tests.

**SK6 a plan is made before anything is written.** Given setup or remove, then the Adapter first returns a `Plan`: for each item, the outcome it would have (`installed`, `updated`, `unchanged`, `removed`, `missing`, `foreign`, `unreadable`, `unsupported`) and the path it would touch; applying runs the same plan, so `--dry-run` (SK9) and the real run cannot differ. Given a plan only, then the config folder is byte-identical, mode and modification times included, to before. Test: `sk6_a_plan_changes_nothing_and_applying_it_has_the_planned_outcomes` (a recursive snapshot of the folder, then the apply compared with the plan). Observer: the Rust test.

**SK7 the hook reports state to roundup.** Decision: the hook reports with the Program status protocol (OSC 7501, `scenarios/terminal-program-status.md`), so an outside session in a roundup Terminal shows its state beside the Agents (PS7, PS10, PS11); nothing else carries it, and no Daemon call is made. The hook entries (vendor event names live in `crates/agents`; the table is the Adapter's):

| Event | Command arguments after `skill report` | Report |
|---|---|---|
| session start | `--state idle --where` | `state=idle`, and one line of context on stdout (SK8) |
| user prompt submitted | `--state working` | `state=working` |
| permission prompt | `--state blocked --kind permission` | `state=blocked:kind=permission` |
| question dialog | `--state blocked --kind question` | `state=blocked:kind=question` |
| turn finished | `--state done` | `state=done` |
| session end | `--state clear` | `state=clear` |

Given an outside session in a Terminal that roundup started, when an event fires and its hook runs `rup skill report <args>`, then:

1. the report `ESC ] 7501 ; state=<state>[:kind=<kind>] ST` (`ST` is `ESC \`) is written to the controlling terminal (`/dev/tty`), never stdout or stderr, since a hook's output is captured by the vendor program;
2. roundup's Terminals set `ROUNDUP_TERMINAL=<terminal id>` in the program's environment (X7's `env`, `crates/terminal`), and `report` writes only when that variable is set and `/dev/tty` opens; in any other terminal, and with no tty, it writes nothing;
3. the command exits 0 in every case, usage errors, a missing tty and an unknown `--state` included, since exit 2 blocks the vendor's action (I4); it reads no stdin, makes no network or Daemon call and ends in 100 ms;
4. the report carries no text of the session (no prompt, path, tool input or output): the states, the kind and nothing else.

Tests (`sk7_`, Rust, `crates/rup/tests/`, the built `rup` run under a pty): `sk7_each_state_writes_its_report_to_the_tty_only`, `sk7_nothing_is_written_without_the_terminal_marker_or_a_tty`, `sk7_the_command_always_exits_0_and_is_fast`, `sk7_a_report_carries_only_state_and_kind`; `sk7_a_roundup_terminal_sets_its_marker` (`crates/terminal/tests/`). Observers: the Rust tests; a real-Daemon run in which a shell in a roundup Terminal runs `rup skill report --state blocked --kind question` and the Rail row and Needs you entry appear (PS10, PS11), then `--state clear` removes them; and, once on the Mac, a real Claude Code started in a roundup Terminal after `rup skill setup` shows `working` while it works and `needs-you` at a permission prompt (hook input shapes: `spikes/hooks-state/*.jsonl`). Policy: choosing `done` for a finished turn keeps the Kind when the user returns to it; PS4 drops `working` and `blocked` on a new prompt.

**SK8 the session learns where it runs, and Agents are left alone.** Given `rup skill report --state idle --where`, when it runs in a roundup Terminal (SK7.2), then stdout holds one line of plain text (the vendor program adds it to the session's context), naming that it runs in a roundup Terminal, the Terminal's id, and `run "rup help" to learn the commands`; outside a roundup Terminal it prints nothing. Given `ROUNDUP_AGENT` set, then every `report` form writes and prints nothing and exits 0: an Agent roundup started keeps its Brief and its own hooks (E3, A4), so an installed hook never doubles or alters them (P9). Setup and remove touch no file of a running Agent's session (its launch settings and Brief under the data folder) and the Launcher's output for a new Agent is the same with and without the items installed. Tests: `sk8_where_prints_one_line_in_a_roundup_terminal_and_nothing_elsewhere`, `sk8_an_agent_environment_makes_every_form_silent`, `sk8_setup_and_remove_leave_a_running_agents_files_alone` (`crates/rup/tests/`, with a fake Agent's launch files compared byte for byte). Observer: the Rust tests; the one-time Mac observation of SK7 also states whether the session, asked where it runs, names the Terminal.

**SK9 the `rup skill` commands.** `rup skill setup`, `rup skill status` and `rup skill remove` are commands of `rup` run on the shell by the owner; they call the Adapter in the process and need no Daemon and no `ROUNDUP_AGENT` (an amendment to I1's "no other command" and I5, for `skill` and its subcommands only; `skill report` is the hook's, listed in `rup help skill` as internal). Given each, then:

1. each prints one line per item, `<outcome> <item> <path>` (`installed skill /home/o/.claude/skills/roundup/SKILL.md`), outcomes as SK6/SK4 name them, and nothing else on stdout; `--json` prints the list as one JSON document (`[{"item", "outcome", "path"}]`);
2. `--dry-run` (setup and remove) prints the plan of SK6 with each outcome prefixed `would `, writes nothing and exits as the real run would;
3. `--force` (setup) replaces a foreign skill (SK3); with `status` or `remove` it is bad usage;
4. exit codes follow I4: 0 when every item is `installed`, `updated`, `unchanged`, `removed`, `current` or `missing` (`status` exits 0 whatever it reports, apart from the failure below); 1 when setup or remove met a `foreign`, `unreadable` or `unsupported` item, or a write failed, with a line `rup: <cause>` then what to do next on stderr and nothing written for the refused item; 2 on bad usage;
5. `rup help skill` and `rup skill --help` list the three commands, their flags and one example each, to stdout; `rup help` lists the noun with one line.

Tests (`sk9_`, Rust, `crates/rup/tests/skill.rs`, the built `rup` with `HOME` and `CLAUDE_CONFIG_DIR` in a temporary folder): `sk9_each_command_prints_one_line_per_item_and_json_prints_the_list`, `sk9_dry_run_prints_would_lines_and_writes_nothing`, `sk9_force_only_belongs_to_setup`, `sk9_exit_codes_are_0_1_and_2_with_the_cause_on_stderr`, `sk9_help_lists_the_skill_commands`; `i1_every_mcp_tool_is_a_command_and_no_command_is_extra` is amended to allow `skill`. Observer: the Rust tests; none starts `claude` or a Daemon.

**SK10 Settings turns it on and off.** Given App Settings (U3799), then a switch in its **Agents** group, labelled `Teach other Claude Code sessions about roundup`, shows the state of the Adapter's items through new Daemon methods `skill.status`, `skill.setup` and `skill.remove` (Contract recipe of `.agents/builder.md`: `crates/contracts`, regenerated `contracts/generated/`, every caller in the same PR; names to add to `GLOSSARY.md`: **Skill setup** (`skill.status`, `skill.setup`, `skill.remove`), user label "teach other sessions"; the methods call the Adapter of SK1–SK6 and share no code with `rup skill` beyond it). Then:

1. it is on when both items are `current` or `outdated`, off when both are `missing`, and neither on nor off (shown as off, with the state named) when the items are `foreign`, `unreadable` or `unsupported`; the text under it names the state in words (`Up to date`, `Out of date`, `Not installed`, and for the others the cause);
2. turning it on calls `skill.setup`, turning it off calls `skill.remove`, once each, and the state shown after is the one the method returns; the choice is stored in the files, not in an App preference, so the shell and the App agree and nothing is saved twice;
3. an `outdated` state shows an `Update` button that calls `skill.setup`; the App never installs, updates or removes on start, on reload or on any other action (P9: it spends no turn and changes no file the user did not ask to change);
4. the control is an `ui/` primitive (a Switch wrapping Ark UI), reached by keyboard, and applies at once as U3806 requires, with no Save step; the state is read again each time Settings opens and after each call.

Tests (`sk10_`): `sk10_skill_status_setup_and_remove_call_the_adapter` (`crates/rupd/tests/`, a temporary config folder), `sk10_the_switch_calls_setup_and_remove_once_each_and_shows_the_result`, `sk10_update_calls_setup_and_nothing_installs_on_open` (`apps/desktop/src/settings/`, behaviour only: calls, roles and text, no looks). Observer: the Vitest tests with a faked Daemon; a real-Daemon run (the U144 harness) in which turning the switch on writes the items into a temporary config folder and off removes them; the design critic's captures of the Agents group on the densest seed (`artifacts/ux/sk10/`, dark mode).

**SK11 a failure shows its cause and the fix.** Given a call of SK10 that fails or reports `foreign`, `unreadable` or `unsupported`, then the switch returns to the state the files are in, and the text under it shows the cause in one line and the fix in a second, in the words of the Adapter's error and not a code: `foreign`: a skill named roundup that roundup did not install is in the folder; remove it, or run `rup skill setup --force`; `unreadable`: the file that cannot be read, and that roundup leaves it as it is; `unsupported`: no Claude Code was found; a write failure: the path and the system's reason. The text is rendered as text (the path is not markup), the failure raises no Toast and no OS notification (P3), and nothing else in Settings is affected. Tests: `sk11_a_refused_setup_shows_cause_and_fix_and_the_switch_returns` and `sk11_a_cause_is_rendered_as_text` (`apps/desktop/src/settings/`). Observer: the Vitest tests; the design critic's capture of the failed state with a 300-character path (`artifacts/ux/sk11/`, dark mode).
