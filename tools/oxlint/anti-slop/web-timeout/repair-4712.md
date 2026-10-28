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
