# User actions

Module: `crates/rupd` (`src/extensions/`, the Extension host), with `crates/rpc` and `crates/contracts`; `apps/desktop` (`switcher/`). Ids: UA1–UA13.

Specification for #5255. Implementation follows in order: #5256 (UA1–UA8, the Daemon, Contract recipe in `.agents/builder.md`), then #5257 (UA9–UA12, the App). They stand on `scenarios/named-actions.md` (NA1–NA13, #5236–#5238): `action.list`, `action.run`, `action.serve` and `rup actions` / `rup do` exist before either starts. A spec merge claims no behavioural pass; every test named here is planned.

Outside evidence (#5255): in Rex, Superlogical's Mac terminal multiplexer, the owner's Lua config defines actions by name with arguments; they show in the command palette, bind to keys, and run with `rex do <name>`; `rex actions` lists the loaded ones.

**User action** (`UserAction`, `action.userList`): a named action the owner wrote in an Extension (`docs/extension-interface.md`), run by the Daemon's Extension host. It has the shape of a Named action (NA1: name, label, typed arguments) and a `source` of `user`. The owner's file is the only source of one (policy: no Project folder, Agent or Todo adds one).

## Decisions

Policy: **where Extensions run.** Each Extension runs in its own child process of `rupd`, started by the module `crates/rupd` (`src/extensions/`), the Extension host, running the manifest's `module` with the owner's `node` and speaking JSON over its stdio. No JavaScript engine is embedded in `rupd` (rule 7: cold start, idle RSS). A throw, hang or crash is the child's and ends only that child. The host starts after the Daemon serves its socket and never delays it. Candidate libraries and the `node` requirement are the implementer's `Reuse:` section (rule 9).

Policy: **where the config lives.** The owner's Extensions are folders `<extensions>/<name>/` holding `rup-extension.json` (`{ name, module, permissions, types? }`) and the module, where `<extensions>` is `~/.roundup/extensions` unless the Daemon is opened with another folder (tests do). A Project folder's files never load code, so opening someone else's repository runs nothing.

Policy: **declaring an action.** The module's `register(on)` calls `on("action", { name, label, args? }, hook)`. `args` are NA3's: `key` with a type of `string`, `integer` (bounds), `boolean` or `choice`, optional unless marked required. The hook is `($, e, next)`: `e.args` are the checked arguments, and it returns `{done}` or `{deny: "<cause>"}`. An action takes no secret, path to read or text that is sent, as NA's policy says, and has no key: naming adds no chord (U2241 stands).

Policy: **permissions.** `permissions` lists the members of `$` the module may use: `agents`, `todos`, `pads`, `bus`, `ui`, `store`, `clock`. `rupd` enforces them on the host's calls, not the module's word.

Policy: **the list.** The Daemon's `action.list` is the App's list (NA5, NA6) followed by the loaded User actions, each row with `source: "user"` and no keys. `action.userList` returns the User actions alone, and the event `action.userChanged` follows every load, reload and removal. `action.run` of a User action runs in the host and does not need the App; every other name relays to the App as NA7 says. `rup actions` and `rup do` print and send these rows as NA11 and NA12 say, with no `rup` code.

## Daemon (#5256)

Observer for UA1–UA8: `crates/rupd` tests over a real socket with a fake App connection (NA6) and Extension folders in a temp directory. UA1–UA5 and UA7 use a scripted stand-in for the host's child; UA6 and UA8 start a real child (they test the process boundary, the only thing a stand-in cannot). No `claude`, no display.

**UA1 an Extension's actions load.** Given an Extension folder whose manifest is valid and whose `register` declares `user.deploy` with a label and a `target` choice argument, when the Daemon opens, then `action.userList` holds one `user.deploy` row with that label, its argument and `source: "user"`, `action.list` ends with the same row after the App's, and the Daemon served its socket before the host started the child. Test: `ua1_a_registered_action_is_listed_after_the_apps`.

**UA2 a bad manifest loads nothing and says why.** Given manifests that omit `name`, `module` or `permissions`, name a `module` outside their own folder, list a permission other than the seven, or are not JSON, and one valid Extension beside them, when the Daemon opens, then each bad Extension adds no action, raises one `extension.problem {extension, cause}` event whose cause names the file and the broken part, and the valid one loads. Test: `ua2_a_bad_manifest_adds_nothing_and_raises_one_problem`.

**UA3 a name is the owner's own.** Given a name that breaks NA1's pattern, is a built-in name in the App's list (`agent.new`), is a retired built-in name, or is already taken by another loaded Extension, when it is declared, then it is not listed, `action.list` holds one row for the name and it is the built-in's, and one `extension.problem` names the action and the rule (`pattern`, `built-in`, `taken`). Given the App registers after the load, then the check runs again at registration and a collision is dropped the same way. Test: `ua3_a_user_action_cannot_take_a_built_in_or_taken_name` (table-driven over the cases and both orders).

**UA4 permissions are enforced.** Given an Extension declaring only `todos`, when its hook calls `$.todos.*`, then the call is made and is a Touch under the Actor `{kind:"ext", id:"ext:<name>"}`; when it calls `$.pads.*` or `$.agents.*`, then the host refuses it `FORBIDDEN` naming the permission `pads` and the manifest, nothing is read or written, and the hook sees that error. An Extension never gains a method an Ext Actor lacks (CL3): `agent.context` and `agent.brief` stay `FORBIDDEN` with `agents` declared. Tests: `ua4_a_declared_permission_is_used_and_touched_under_the_ext`, `ua4_an_undeclared_permission_is_forbidden_and_does_nothing`.

**UA5 run by name.** Given `user.deploy`, when the user sends `action.run {name, args}`, then the hook runs once with the checked arguments and the caller gets `done`, or a refusal carrying the hook's `deny` cause; an unknown, missing, mistyped or out-of-bounds argument is `INVALID_PARAMS` naming it and the hook does not run. Given a caller that is an Agent or Door, then it is `FORBIDDEN` as NA8 says and the hook does not run. Given no App registered, the run still works. Each accepted run is a Touch `action.run` / `action:user.deploy` with argument keys, never values. Tests: `ua5_run_checks_arguments_then_runs_the_hook_once`, `ua5_only_the_user_runs_a_user_action`.

**UA6 a throwing Hook is skipped, once, and the Daemon goes on.** Given a hook that throws, one that never answers and one whose child process exits, when each runs, then the Daemon keeps serving every other call, the caller gets a refusal naming the action and the Extension (a hang ends at `CALL_TIMEOUT`), exactly one `extension.problem` is raised per failed run, and the next hook in the chain still runs (fail open). Given `.catch` on the hook, then its answer replaces the failure and no problem is raised. Given the child exited, then that Extension's actions leave `action.userList` until it reloads (UA7). Tests: `ua6_a_throwing_hook_is_skipped_with_one_problem`, `ua6_a_hook_that_never_answers_ends_at_the_timeout`, `ua6_a_dead_child_unlists_its_actions_and_the_daemon_serves_on`.

**UA7 hot reload.** Given a loaded Extension with a pending timer and a value in `$.store`, when its module file is saved with a new action, then the old child's timers are dropped, `register` runs again, `action.userList` shows the new set, `action.userChanged` is sent once, and `$.store` still holds the value. Given the saved file throws in `register`, then the last good registration stays, and one `extension.problem` names the file. Given the folder is deleted, then its actions leave the list. Tests: `ua7_a_saved_module_re_registers_and_keeps_the_store`, `ua7_a_bad_save_keeps_the_last_good_registration`.

**UA8 a bad Extension never stops the Daemon.** Given Extensions that exit at once, loop forever in `register`, print without end, or reject `register`, and `node` missing from the path, when the Daemon opens, then it serves `daemon.ping` and `action.list` as without them, raises one `extension.problem` per Extension (for missing `node`, one, saying `node` was not found and how to install it), and a `register` still running after `CALL_TIMEOUT` is killed. Test: `ua8_a_broken_extension_never_stops_the_daemon`.

## App (#5257)

Observer for UA9–UA12: Vitest in `apps/desktop/src/switcher/` on the real Switcher and connected App with a fake Daemon connection, as `u2572_actions.test.tsx` does; no browser. The Toast of UA11 is asserted by its call and text, its look is the design critic's (nothing new renders: the rows and the Toast are existing components).

**UA9 the Switcher lists them.** Given the Daemon's `action.userList` holds `user.deploy` and `user.sync`, when the Switcher opens and with a query, then both appear in the Actions group after the built-in actions, labelled with their label, in the Daemon's order, and the query ranks them with the built-ins as Z3788b ranks actions. Given the list changes (`action.userChanged`), then the next open shows the new set. Given a User action with a required argument, then it is not shown (policy: arguments are typed in `rup do`; the Switcher sends none). Test: `ua9_user_actions_follow_the_built_in_actions_and_rank_with_them`.

**UA10 choosing runs it.** Given the Switcher showing `user.deploy`, when the user chooses it, then the App sends `action.run {name: "user.deploy", args: {}}` once, the Switcher closes, and focus returns where it was before it opened. Test: `ua10_choosing_a_user_action_runs_it_once_by_name`.

**UA11 the answer is shown.** Given the run answers `done`, then nothing more shows. Given it answers a refusal (the hook's `deny`, `extension.problem`'s failure), then one Toast carries the action's label and the cause. Given an `extension.problem` event from the Daemon, then exactly one Toast shows its Extension and cause, whatever the Switcher's state. Test: `ua11_a_refusal_and_a_problem_each_raise_one_toast`.

**UA12 nothing built-in moves.** Given no User action, then the Switcher is as `main` renders it. Given User actions, then the built-in actions, the destinations and the Top ten tasks (`.agents/data/journey.md`) keep their order and press counts; no key, chord, menu item or Help line is added (U2241, U3787b, NA's no-new-binding policy); a User action named like a built-in is ignored by the App, which shows only the built-in; and an `action.userList` that fails shows the built-in list with no User action and no Toast on open. Tests: `ua12_user_actions_move_nothing_built_in`, and the regression observers pass unchanged: `u2572_actions.test.tsx`, `u2241_no_other_chord_is_taken_at_app_scope`, `u2539b_top_ten_tasks_complete_within_three_presses`.

## Regressions this lesson keeps

A throwing Hook is skipped with one Toast and the caller goes on (UA6). Permissions are declared and enforced by `rupd` (UA2, UA4). A User action cannot take a built-in name (UA3, UA12). A bad Extension never stops the Daemon (UA8). Built-in actions keep NA2's one-name rule and NA10's confirm and undo.

Policy: the deliverable's observers are Vitest and Rust tests; the Toast and Switcher rows are existing components with new text and rows only, so the design critic has nothing new to judge here and no Mac observation is needed.


## Overlapping App reads (#5480)

**UA13 an older reply cannot replace the later list.** Given one connected Project and two pending `action.userList` reads, A started before B, when B succeeds and its rows appear in the open Switcher, then completing A successfully with a different set leaves exactly B's User actions available; no row unique to A appears. Close and reopen the Switcher: it still offers exactly B's User actions. Test: `ua13_an_older_reply_cannot_replace_the_later_list` (planned, in `apps/desktop/src/switcher/ua9_user_actions.test.tsx`).

Run that test over all four combinations of these cases:

| Earlier read A | Later read B | B's result |
|---|---|---|
| Initial read when the Switcher mounts | Read triggered by `action.userChanged` | One argument-free User action absent from A |
| Initial read when the Switcher mounts | Read triggered by `action.userChanged` | Empty list |
| Read triggered by `action.userChanged` after an initial read has settled | Read triggered by a second `action.userChanged` | One argument-free User action absent from A |
| Read triggered by `action.userChanged` after an initial read has settled | Read triggered by a second `action.userChanged` | Empty list |

A's result contains an argument-free User action absent from B. The observer mounts the real Switcher with the connected Project and fake Daemon, as the UA9 test does, and controls the two RPC promises independently. Observe that each read has started before resolving either; resolve B, observe its rows, then resolve A and await its RPC continuation before asserting the final options. A fixed sleep or an assertion that can pass before A's continuation runs does not prove this clause. Assert the rendered option identities, not a request counter or an internal generation value. No real process, browser or wall-clock delay is needed.

Policy: UA9–UA12 remain acceptance, including required-argument exclusion, built-in order, silent failed reads and choosing by name. This extension specifies successful overlapping reads only; failures, Project teardown and multiple windows are outside UA13. No RPC, Event or User action schema changes. Implementation stays in `apps/desktop/src/switcher/Switcher.tsx` and its existing UA9 test file; it adds no shared request-ordering abstraction.

Journey: this keeps the Switcher's actions current during Intervene; it does not change the journey's navigation or press counts. The behavioural observer above proves webview ordering only. For the implementation's rendered regression observation, use the isolated headless App at 1512×950 in dark mode with `tree-40`, the Switcher open, and failure text visible for a failed action. Preserve Checks 2, 5 and 6 (`docs/design-system.md`, heading “The checks”: type and spacing, contrast, control states and targets), and every Check passing on main. Leave `just capture UA13` evidence under `artifacts/ux/UA13/` as `.agents/data/harness.md`, heading “Captures”, requires. Layout and looks belong to that observer, never the Vitest assertions. This specification-only change renders nothing and requires no capture or Mac observation.

Implementation verification: `pnpm --filter desktop exec vitest run src/switcher/ua9_user_actions.test.tsx` proves UA13 and retains the UA9–UA12 regression tests; run `just ready` as the Code recipe requires. The new test is planned acceptance, not evidence that this specification delivers the repair.

## UA5 observer references (#5500)

**UA5500 UA5 names its surviving observers.** Policy: the UA5 paragraph's `Tests:` list contains exactly `ua5_run_checks_arguments_then_runs_the_hook_once` and `ua5_only_the_user_runs_a_user_action`, in that order; remove the standalone no-App test reference. Preserve every given/when/then clause of UA5, including running without a registered App, and leave UA1–UA13 unchanged otherwise. Acceptance is inspection of the UA5 paragraph and implementation diff, not a new source-text test.

Check 1: `crates/rupd/src/extensions/tests.rs`, `ua5_run_checks_arguments_then_runs_the_hook_once`, exercises successful and refused runs without registering an App; it remains the observer for UA5's no-App clause. Check 2: the same file's `ua5_only_the_user_runs_a_user_action` retains the Actor refusal observer. Both functions exist on main. Removing duplicate test bodies belongs to #5489, not this correction.

Policy: implementation scope is only UA5's `Tests:` list in this file. No runtime, contract, UI, design Check or Principle gate changes; no rendered or Mac observation is required. Verify the exact two-name list and unchanged behavioral text by diff inspection, then run `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`; exit 0 passes, and report each failing command separately with its exit code. This specification adds acceptance only; it does not claim the reference correction is implemented.
