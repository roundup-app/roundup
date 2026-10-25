# U130/U133 choice controls

Baseline: `235ba2d91d89ad7b449dea2a950cd37d0fa185c5`.
Runtime: `becd68ffadc01d9e5d47888b1b581e33e01b533d`.
Continuation of #3948, whose final focus and check repairs are on main through #4005.

RadioGroup and SegmentGroup draw no first-frame press feedback. In isolated
headless Chromium, dark, 1512×950, a real pointer press followed by the first
animation frame leaves each label's opacity and ink unchanged. The raw readings
are in `choice-press-base.json`. Releasing outside calls neither choice handler.

An in-process Stylelint `declaration-no-important` audit over the 54 authored
stylesheets reports 37 diagnostics. Eight belong to these two input overlays.
The installed Ark controls supply native inputs and a composition API; Checkbox
already uses it to let the stylesheet own the full labelled hit area. No new
input state machine is needed.

The native-key and pointer tests use the actual shared primitives and callback
outputs through their existing public API. They assert selection and call counts,
not paint or geometry. The rendered observer owns first-frame paint and Checks.

## Implementation

| Before | After | Why |
| --- | --- | --- |
| Both held labels remain at opacity 1 | First pointer and Space frames read the press Token, 0.9 | Immediate feedback reaches the mark and label together |
| Eight input geometry declarations use importance | Ark composition lets the shared stylesheet own input geometry | The labelled hit area remains full size without importance |
| Ark retains active state after focus leaves | The radio machine clears active state when focus leaves | A cancelled Space press cannot reappear on refocus |

`choice-press-head.json` records the first frame after trusted pointerdown and
Space keydown, release outside, and blur before Space release. Both controls
restore opacity 1 and call nothing on cancellation. Normal pointer, Space and
arrow activation selects only the second choice and calls its handler once.
The two-line dependency patch changes the installed ESM and CommonJS builds;
RadioGroup and SegmentGroup both use that existing radio machine. No local
press state or synthetic production input is added.

The browser driver's held-key command takes the literal space character;
`keydown Space` sends an empty key and is not a native Space observation.
The final probes and blur regressions use the literal character. The pointer
cancellation tests use explicit mouse moves because a locator hover does not
update the driver's saved release coordinate.

Scope remains the two choice controls and their dependency repair. Complete
strict lint, the other controls' press coverage, Rail alignment and optical
baselines, extended Checks, palette/system accent, native material/fallback,
and Mac and same-host performance observations remain on #3824. No native
material or performance pass is claimed.

## Rendered comparison

Seven paired App states at 1512×950, dark, device scale 1, compare the immutable
baseline and runtime above: all five required seeds, the New Workstream dialog
and its failed submit. The dialog is opened through the Todo owner picker by
keyboard. The dense tree remains visible behind it, and “Offline. Reconnect.”
is fully visible. Every D1–D14 and D16 Check passes in every pair, including
D2/D5/D6; the delta reports no regression. `choice-checks.json` holds the paired
statuses; full readings and images stay under `artifacts/ux/U133/choices/`.

Trusted held pointer and Space probes use the two real shared primitives in
`src/ui/u133.html`. `choice-press-base.json` also reproduces Ark's retained
active state after blur; `choice-press-head.json` records it cleared. The head's
press video is 20.2 seconds long. Held text after opacity compositing measures
12.50:1 in light and 12.82:1 in dark (`choice-contrast.json`); these computed
light readings have no screenshot. Captured images remain dark only. Images and video remain uncommitted. These
observations cover choice controls, not the full U130–U137 interaction matrix.

The final importance audit is 29 diagnostics across the same 54 stylesheets,
down from 37. This PR removes all eight importance declarations and both child
combinators in the two choice stylesheets; it enables no strict rule and adds
no suppression. The remaining diagnostics still belong to #3824.

## Validation and integration

The prescribed `just capture U130,U131,U132,U133,U134,U135,U136,U137`
exits 0: Vitest reports 3,986 passed, 57 skipped and zero failed tests.
`u2875d_real_import_reopen_and_resume` passes on its retry in that run; its
isolated rerun with `--retry=0 --maxWorkers=1` passes. The retry remains part
of the full-run record. The initial related run was replaced after 54 passing
files by this complete capture run; it is not claimed as a complete pass.

Main `3865e3f3e5e9aab9b17479ae8d8172d9ad60a664` merges cleanly in
`808e341b3b48df2cc3e49cf908116dbcd0a3b752`. Its work is retained without
conflict resolution; the remerge diff and `merge-loss` are empty. The two
choice wrappers, their styles, manifests and dependency patch are identical
to the captured runtime above. The incoming work changes tests, native
recorder handling and documentation, without changing the captured styles.

After integration, all 14 focused choice-control and New Workstream caller
tests pass with `--retry=0 --maxWorkers=1`. Both `just lint-web` and
`just lint-rust` pass, including `ALL PROOFS CHECK`. The frozen install, Token ownership and merge-loss pass.
