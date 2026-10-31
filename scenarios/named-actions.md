# Named actions

Module: `apps/desktop` (`keys/chords.ts`, `keys/registry.ts`, the menu in `App.tsx`, the Switcher), `crates/rupd` with `crates/rpc`, `crates/contracts` and the App's relay handler, and `crates/rup` (`src/cli.rs`). Ids: NA1–NA13.

Specification for #5235. Implementation follows in order: #5236 (NA1–NA5, the App), #5237 (NA6–NA10, the Daemon, Contract recipe in `.agents/builder.md`), #5238 (NA11–NA13, `rup`). A spec merge claims no behavioral pass; every test named here is planned.

Outside evidence (#5235): in Rex, Superlogical's Mac terminal multiplexer, each action has a name and `key=value` arguments, the palette, keybindings and CLI run the same actions, `rex actions` lists them, and `rex do <name> key=value` runs one and fails on an unknown argument.

**Named action** (`NamedAction`, `ActionArg`, `action.list`, `action.run`): one command the App runs, named once for every way of running it. It has a stable `name`, a label, the keys that run it now, typed arguments and whether it is available now. The `CHORDS` and `LEADER` tables are its only source (policy: a second list is a defect). The menu bar, the Switcher, the key bindings and `rup` look an action up by its name.

Policy: a name is lowercase `noun.verb` (`^[a-z]+(-[a-z]+)*\.[a-z]+(-[a-z]+)*$`), unique, and never renamed or reused for another command once on `main`; a retired command's name stays reserved. An argument is `key=value` with a type of `string`, `integer` (with bounds), `boolean` or `choice`, and is optional unless marked required. No action takes a secret, a path to read or text that is sent: an argument only chooses or pre-fills, so every action keeps the confirm, undo and prompt rules it has from a key.

Policy: no new binding. Naming an action adds no chord, no menu accelerator and no App-scope key; U2241 (`scenarios/ui-shortcuts.md`) allowlist of App-scope chords stays exactly as `main` holds it, and U3787b's ownership of editor and Terminal input stands.

## Names

| Entry | Name | Arguments |
|---|---|---|
| `⌘N` / `⇧⌘N` | `agent.new` / `agent.new-with-prompt` | `prompt` string, optional: fills the field, sends nothing |
| `⌘T` | `terminal.new` | — |
| `⌘K` | `leader.open` | — |
| `⌃⌘J` | `attention.jump` | — |
| quick-add (configured) | `todo.capture` | — |
| `⌘B` | `terminal.switch` | — |
| `⌘=` `⌘-` `⌘0` `⌘F` | `terminal.text-larger` `terminal.text-smaller` `terminal.text-reset` `terminal.find` | — |
| Rail `M` / rename / `R` / `⌘⌫` | `rail.move` / `rail.rename` / `agent.restart-mode` / `rail.remove` | — |
| `?` / `⌘/` / `⌘,` / `⌘O` | `help.open` / `ask.open` / `settings.open` / `project.choose-folder` | — |
| `⌘Z` / `⇧⌘Z` | `edit.undo` / `edit.redo` | — |
| Bench `1`–`9` | `todo.assign-slot` | `slot` integer 1–9, required |
| Bench `⏎` `N` `O` `M` `D` `E` `Esc` | `todo.open-draft` `todo.add` `todo.assign` `shelf.maximise` `todo.delete` `todo.export` `shelf.close` | — |
| Triage `T` `A` `W` `Tab` `⇧Tab` `X` `C` `Esc` | `todo.triage-enter` `todo.triage-assign` `todo.triage-workstream` `todo.triage-nest` `todo.triage-unnest` `todo.triage-done` `todo.triage-comment` `todo.triage-leave` | — |
| Triage `J K` | `todo.triage-move` | `direction` choice `up`\|`down`, required |
| editor `⇧⌘B` `⌥⌘8` `⌥⌘7` `⌥⌘C` `⌘I` `⌘E` | `editor.quote` `editor.bullet-list` `editor.numbered-list` `editor.code-block` `editor.italic` `editor.inline-code` | — |
| Leader `A` `P` `C` `J` `⇧J` `K` `M` `W` `B` `T` `I` | `leader.assign` `leader.project` `leader.changes` `leader.attention` `leader.attention-other-project` `leader.row` `leader.bubble-minimise` `leader.bubble-close` `leader.shelf` `leader.capture` `leader.inbox` | `leader.row`: `query` string, optional, pre-fills the Switcher; others — |

An entry added later (#5215's Workstream and Mode chords) takes a name by the rule above in the PR that adds it.

## App (#5236)

Observer for NA1–NA5: Vitest in `apps/desktop/src/keys/` on the real tables, registry and connected App, as `u3787b_menu_and_key_share_one_action` does; no browser.

**NA1 every command has one name.** Given `CHORDS` and `LEADER`, when the action list is built, then every entry has a name that matches the policy pattern, names are unique, each argument has a type, and the names equal the table above plus entries added since (each added entry is named in its own PR). An entry with no name fails the type check; a renamed or dropped name fails a pinned list kept in the test's fixture. Test: `na1_every_entry_has_a_unique_stable_name`.

**NA2 one lookup, one run.** Given a registered owner for `agent.new`, when the same action is run from its menu item, from its key and from its Switcher row, each against the same target, then the owner's handler runs exactly once per run with identical effect, and the menu item, Switcher row and Help line show the same label and current keys. Test: `na2_menu_key_and_switcher_run_one_action_by_name`.

**NA3 run by name and arguments.** Given the connected App, when `runAction(name, args)` is called, then: an unknown name is refused as `unknown-action` naming it; an unknown, missing required, mistyped or out-of-bounds argument is refused naming that argument and runs nothing; a repeated key is refused; a valid call runs the owner's handler once and answers `done`, or `awaiting` when the action opened a confirm or a prompt for the user to finish. A refusal reaches the caller as text with its cause and what to do next. Test: `na3_run_by_name_checks_name_and_arguments_then_runs_once` (table-driven over the cases).

**NA4 availability is the key's.** Given focus in an editor, in a focused Terminal, or under an open modal, and a selected Rail row, when each named action is listed and run, then its availability equals the Switcher's capture (U2572) for the same focus: unavailable actions list `available: false` with a cause (`needs a Rail row`, `a dialog is open`) and are refused with that cause when run; no key event is dispatched or prevented, and editor and Terminal text is unchanged. Test: `na4_availability_and_input_ownership_match_the_key`.

**NA5 the list.** Given the connected App, when the list is read, then it holds each action's name, label, keys as Help shows them now (a configured quick-add key included), arguments and availability, in the order of Help, with one row per name. Test: `na5_list_rows_carry_name_label_keys_arguments_and_availability`.

Regression observers, unchanged and passing: `u3787b_menu_covers_bound_commands`, `u3787b_menu_and_key_share_one_action`, `u3787b_scoped_menu_does_not_steal_terminal_input`, `u2572_actions.test.tsx`'s tests, and `u2241_no_other_chord_is_taken_at_app_scope`; no Help, hint-line or press-count text changes (policy).

## Daemon (#5237)

Module: `crates/rupd`, with `crates/rpc` and `crates/contracts`; the Contract recipe applies, so the methods below, the App's answering handler and the new names in `GLOSSARY.md` change with every caller in one PR, and `contracts/generated/` is regenerated. Observer for NA6–NA9: `crates/rupd` tests over a real socket with a fake App connection that answers as the real handler's contract says; NA10 runs the App's handler in Vitest. No `claude`, no display.

Policy: the Daemon holds no action list. The App registers itself as the one answerer (`action.serve`); `action.list` and `action.run` relay to it live and return its answer, so the list is always the App's own (NA5). A second registration replaces the first; a request pending at the replaced one ends as NA9 says. Closing the App's connection ends its registration.

**NA6 list.** Given the App registered, when a caller sends `action.list`, then the result is the App's list of NA5, unchanged. Given no App registered, then the call fails with code `APP_CLOSED` whose message says the roundup App is not open and to open it and retry; nothing is cached or guessed. Tests: `na6_list_returns_the_apps_list`, `na6_no_app_is_app_closed_with_cause_and_fix`.

**NA7 run.** Given the App registered, when a caller sends `action.run {name, args}`, then the request reaches the App once and the caller gets the App's `done` or `awaiting`. An unknown name or argument is refused as `INVALID_PARAMS` naming it, never guessed or nearest-matched, and the App is not asked. Given no App, the call fails with `APP_CLOSED` as NA6 and nothing runs. A request the App answers with a refusal (NA3, NA4) passes that refusal through with its cause. Tests: `na7_run_reaches_the_app_once_and_returns_its_answer`, `na7_unknown_name_or_argument_is_refused_before_the_app`, `na7_app_refusals_pass_through`, `na7_run_with_no_app_runs_nothing`.

**NA8 who may ask.** Given a caller with no Agent id (the user's shell, the App) and a caller that is an Agent or Door, when each sends `action.list` and `action.run`, then every caller may list; only the first may run, and an Agent's or Door's `action.run` is refused `FORBIDDEN` (typing and keys stay the user's, M13) with nothing sent to the App. Each accepted list and run is a Touch under the caller's Actor (`ctx.touch("action.list" | "action.run", "action:<name>")`) and shows in Provenance with the name and argument keys, never argument values. Tests: `na8_only_the_user_runs_an_action`, `na8_each_call_is_a_touch_with_name_and_argument_keys`.

**NA9 lost answers.** Given a run the App has received, when the App's connection closes or is replaced before it answers, or `CALL_TIMEOUT` (10 s) passes, then the caller gets `UNKNOWN_OUTCOME` (the action may have run) and the Daemon does not send it again. Given the same `action.run` sent twice, then it is two runs; there is no operation id (policy: the App's confirm and undo rules guard repeats). Test: `na9_a_run_the_app_never_answered_is_unknown_outcome_and_not_retried`.

**NA10 same confirm and undo.** Given the App's handler and an action that confirms or undoes by key (`rail.remove`, `todo.delete`, `edit.undo`), when it is run through `action.run`, then it opens the same confirm and leaves the same Undo entry as the key does, and answers `awaiting` until the user decides; a call never confirms, never skips a confirm and never undoes on its own. An argument cannot carry a confirmation (NA3 refuses the argument as unknown). Test: `na10_run_keeps_confirm_and_undo_of_the_key` in `apps/desktop/src/`, asserting the same dialog, call count and Undo entry for key and relayed run.

## `rup` (#5238)

Module: `crates/rup` (`src/cli.rs`). Observer for NA11–NA13: `crates/rup/tests/cli.rs`, the built `rup` (`CARGO_BIN_EXE_rup`) against an in-process Daemon on a temp socket with a fake App answering as NA6–NA7 say, as I1's tests do. `actions` and `do` are `rup`-only commands: `rup mcp` does not offer them, and I1's two-face comparison lists them apart, as it does the stream `events`.

**NA11 `rup actions`.** Given the App registered, when `rup actions` runs, then stdout is one line per action in the list's order: name, arguments as `key=<type>` (required without brackets, optional in `[ ]`), keys and `unavailable: <cause>` when it is; exit 0. With `--json`, stdout is exactly the `action.list` result. Given no App, then stdout is empty, stderr is `rup: the roundup App is not open (APP_CLOSED)` and a line saying to open it and run `rup actions` again, exit 1 (I3, I4). Tests: `na11_actions_prints_one_line_per_action`, `na11_actions_json_is_the_result_alone`, `na11_actions_with_no_app_names_cause_and_fix`.

**NA12 `rup do`.** Given `rup do <name> [key=value…]`, when it runs, then the name and each pair go to `action.run` as given (a value may hold `=` and spaces; `-` as a value reads stdin as I6 does), stdout is `done` or `awaiting: <what the App waits for>`, exit 0. An unknown name exits 1 with `rup: unknown action "agent.nw"`, `did you mean "agent.new"?` from the list, and `run "rup actions"`. An unknown argument exits 1 naming it and the action's arguments; a missing, mistyped or out-of-bounds one exits 1 naming it. A token with no `=`, an empty key or a repeated key exits 2 (bad usage, I4) before the Daemon is called. An action the App refuses as unavailable exits 1 with the App's cause. Given no App, exit 1 with NA11's cause and fix, and nothing runs. Given `rup do` run in an Agent's shell (`ROUNDUP_AGENT` set), it exits 1 with the Daemon's `FORBIDDEN` and what to do (NA8). Tests: `na12_do_sends_name_and_pairs_and_prints_the_result`, `na12_unknown_name_suggests_the_closest`, `na12_unknown_or_bad_argument_exits_1_naming_it`, `na12_malformed_pairs_exit_2_before_any_call`, `na12_do_with_no_app_names_cause_and_fix`, `na12_an_agent_shell_is_refused`.

**NA13 help and the rest of the CLI.** Given `rup help`, `rup help actions` and `rup do --help`, when printed, then each lists the command with its usage line and an example (I2), `rup help` shows both in its grouped commands, and all existing commands, I1's two-face test, exit codes and the hook commands' speed (I8) are unchanged. Tests: `na13_help_lists_actions_and_do_with_examples`; `i1_`, `i2_`, `i4_` and `i8_` tests pass unchanged.

## Regressions this lesson keeps

U3787b: one action per chord, the same for menu and key, never taking editor or Terminal input (NA2, NA4). U2241: no new App-scope chord (policy above). `rup do` with the App closed fails with a cause and fix (NA6, NA7, NA11, NA12). Every action `rup do` runs keeps its confirm and undo rules (NA10).

Policy: the deliverable's observers are Vitest and Rust tests; no rendered surface changes and no Mac observation is needed, so the design critic has nothing to judge here.
