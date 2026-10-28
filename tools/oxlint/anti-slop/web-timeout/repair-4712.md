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
