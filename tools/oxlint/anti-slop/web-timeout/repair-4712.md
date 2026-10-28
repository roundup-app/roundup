# Requested observer repair (#4712)

This record is a reproduction, not successful cap evidence for #4451.

- Source: `475b1c9f956e7beaf6b83b3d72f9ca9c4bd25eb6`.
- CI run: https://github.com/roundup-app/roundup/actions/runs/40786093037
- Command: `ROUNDUP_CAPTURES=DV6,U3021c,U3049a,U3299a,U3813,U3814,U3799,U4277c,U3741,U3760,P3557c,U3774,U3776,U461,U462,U461a,U461b,U3728,U3295a,U3295b,U3517f python3 loop/app-data.py pnpm --filter desktop exec vitest run src/header/u475_browser.test.ts`.
- Exit: 1. Full default and JSON reporter output: `repair-4712-header-red.log.gz`.
- Three tests passed; `p3557c_header_rendered_failure_before_and_after_clearing` failed on both configured attempts waiting for the clipboard alert. JSON duration aggregates retries and is not a first-attempt timing bound. The default reporter preserves file/hook cost.
- No concurrent lint ran. A Cargo preparation build started during the reproduction; this failed run establishes no performance claim.

Cause: the observer replaced `navigator.clipboard.writeText`, while ProjectTab now calls the App `writeClipboardText` seam. Its copy succeeds, so the expected failure never appears. Preserve the same visible Copy name, clear and Discard controls while injecting failure at the App boundary.

Remaining: successful isolated source-head result, other reproduced observers, and the complete 46-file requested invocation alongside normal CI workload. No timeout, retry, scenario, assertion or rollout change is authorized by this failed measurement.

## Other requested paths: diagnostic reproduction

`repair-4712-diagnostic.log.gz` retains the complete default/JSON reports for the same capture flags and wrapper with `vitest run src/inbox/u3770_browser.test.ts src/orders/u3078i_rendered.test.ts src/ask/dv5_rendered.test.ts src/importer/u2875d_import_panel.test.tsx src/settings/u3799_app_settings.test.tsx --maxWorkers=3`, source `475b1c9f956e7beaf6b83b3d72f9ca9c4bd25eb6`, exit 1. It ran beside the header diagnostic and initial Cargo preparation, without lint. This is diagnosis, not isolated cap evidence.

| Observer | Reproduction |
| --- | --- |
| DV5 | Passed, 38.071 s, no retry. No code repair inferred necessary. |
| DV6 | Both attempts time out after its App remount: the new App has no requested Made view. The old clipboard stub also bypasses the native App clipboard seam. |
| U3049 | Both attempts wait for a status inside `.import-recovery`; the conflict status now lives in the Import panel's reserved line. The first recovery button is now Copy, so recovery must choose the published Open choices action. |
| U3299 names / retention | Both attempts wait for Reactions and Made without requesting either native menu view. |
| Inbox / Progress / project pages | Real actions reached video finalization, which failed because this runner had no `ffmpeg`. Inbox's configured retry then failed to start over the still-active recording. |

The runner repair is `sudo apt-get update -qq && sudo apt-get install -y -qq ffmpeg` (exit 0). No workflow was edited. The three video observers keep their actions and assertions. Subsequent runs require this encoder. Header clipboard injection uses the fake App seam; DV6 uses the served App seam. Optional views are requested through existing published native menu commands and the host's `onProjectPage` event, never `showView` or a component-only opener.

## Successful isolated header observation

Exact execution source: `bd36d0f27c31d59abcc0f00eead774626f7bcc5b`, after merging `origin/main` at `015467c5a`. Run URL and exact flags/command/results are in `repair-4712-results.json`; the complete default/JSON output is `repair-4712-header-isolated.log.gz`. Exit 0; all four tests passed on their first attempts, no concurrent lint or test invocation. File time including hooks: 34.641 s; complete invocation: 46.32 s. Individual first-attempt durations are 11.928, 5.703, 4.108 and 10.478 s. This proves the header path only, not the other 45 requested files or #4451's full acceptance. Caps, retries, inherited defaults and lint configuration are unchanged.

`repair-4712-six-diagnostic.log.gz` records the next six-file diagnostic (exit 1; 47 passed, 3 failed), matching the test-source snapshot committed as `29aecada2` after its invocation began. It is diagnostic only. Header, Inbox, DV5, DV6, Progress and the names audit passed. Import recovery used an unsupported agent-browser role-focus subaction; retention still named removed classes; project pages still waited for an obsolete foreign diagnostic.

`repair-4712-followup-diagnostic.log.gz` records the two-file follow-up on `af1a5bdeb643dbabf3175724dcc48fa5d368eaf2` (exit 1; 38 passed, 2 failed). Import conflict recovery passed. Retention reached composer Escape and failed waiting for it to close; Settings reached the old Overview activation and failed its page-survival assertion. Their repairs await input focus and select an Agent while preserving every original assertion. U4453b intentionally makes Overview close requested screens, and replaces the retired Order editor with exact legacy Copy/Discard recovery (`scenarios/ui-navigation-always.md`, Order drawer removal); the retention observer follows that existing replacement instead of opening deleted UI.

The full 46-file request now runs on the same exact execution source as the isolated header, with three workers beside `just ready`. Its final report is still required. A failed, skipped or missing observer remains unmeasured, and no exception is justified here. Progress's existing 240,000 ms declaration was not edited or granted an exception; #4451 still decides caps from successful evidence.

## Normal workload: incomplete, failures retained

The 46-file invocation ran beside `just ready` on execution source `bd36d0f27c31d59abcc0f00eead774626f7bcc5b` (workflow checkout `343669a0ecfb83b929aa290053e0f2dd42b785ef`). It was interrupted at the Builder budget before a final JSON report; `repair-4712-normal-46.log.gz` retains the output. This establishes no complete-workload cap bound, and unexecuted/missing files remain unmeasured. No timeout increase follows from it.

The header, DV5, DV6 and requested rendered project-pages observer passed on first attempts under load; project-pages took 56.728 s. The header file took 62.104 s including hooks/multiple tests, while its longest test was 23.491 s: this is not an over-60-second individual test. Two additional ordinary Settings observers failed both attempts: `u3814_project_pages_survive_work_elsewhere_import-work` and `u3814_project_pages_survive_work_elsewhere_project-settings`. Their reported retry aggregates, 59.424 and 45.582 s, are not first-attempt times. They were added to #4712's Scope after `python3 loop/orders.py check` passed. Diagnose those failures and the outstanding retention path before claiming success.

`repair-4712-ready.log.gz` is the concurrent required-check output snapshot. `just ready` had not finished at that snapshot; it is not a green-check record. Keep #4712 and #4451 open. Continue #4716, complete the requested-path repairs, rerun related tests and `just ready`, then obtain the successful complete 46-file log under normal load. The isolated header success remains valid only for its recorded execution SHA.

Final interruption: Vitest exit 130; pnpm/App-data wrapper exit 1; no final JSON reporter output. The concurrent `just ready` was terminated unfinished with SIGTERM at the same Builder budget. These logs preserve failures and progress, never an inferred pass. The PR remains draft for a fix run; required checks and remaining requested observers still need completion. No native Mac observation or unresolved product decision blocks the continuation.
