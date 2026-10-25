# U133 row state observation

Acceptance: `scenarios/ui-visual.md`, “U133 press and row states extensions”.
PR #4005 continues closed PR #3948 from `02a26d885`.

| Before | After |
| --- | --- |
| Selected Rail, Todo and Pad rows stack a stripe, wash or radius | One square selected wash |
| Pointer focus on a disclosure paints a second selected ground | Only selection paints a wash; pointer focus adds none |
| Keyboard focus in #3948's final head turns error Agent agent-7's red name blue | One wash preserves the red name and Kind Glyph |
| Selected, focused and dragged row stacks press ink or dimming | One wash, rest opacity, no shadow or radius |
| Owned-item focus paints an inset or nested cue | The full-width leaf owns one wash; its nested row paints none |
| Owned-items disclosure loses focus after paint; Space does nothing | Focus stays on the disclosure; Space opens its items |

## Paired evidence

Isolated headless Chromium 156, dark, 1512×950, device scale 1. Baseline:
main `c475d1a4f`; runtime head: `499ca3e94`. The later clean merge of main
`65d8e0c81` changes only loop guidance and performance documents. Storage is
cleared before each seed on both origins.

`artifacts/ux/U133/continuation/{base,head}/` holds screenshots and Check
readings for all five prescribed seeds, selection, pointer disclosure,
keyboard focus, dense failure, Shelf Todo focus, open Drawer, owned-item focus,
Pad focus/selection and combined selection/focus/drag. Failure text is
“Offline. Reconnect.” The paired delta has no regressed Check. D2, D5 and D6
pass in every capture. D12 fails on the Pad list in both revisions (value 32);
all other existing Checks pass. These are web observations, not native evidence
or a completed extended D7 observer.

The pointer-focus probe focuses agent-1's Pads control after a real pointer
click selects agent-3. Its recorded `focusVisible: false`, active button and row
backgrounds distinguish pointer modality from keyboard focus: agent-1 has no
wash and agent-3 has one. The keyboard probe focuses error Agent agent-7; its
name stays `rgb(255, 107, 107)`. The pre-repair blue-name reading at `57847ee53`
is retained in `failure-ink-before.rows.json`.

The baseline's known disclosure focus loss prevents Space from exposing the
owned items; a programmatic button click exposes them for the paint comparison
only. Head opens them through Space. The behavioral test below proves this
without substituting a programmatic click.

Head's selected/focused/dragged agent-9 has opacity 1, one selected background
image, radius 0 and no shadow. `head/row-states.webm` records this interaction;
ffprobe reports a 4.1-second video with frames after ffmpeg installation.
Screenshots and video remain uncommitted. The earlier `row-states.json` and
`critic-fix/` readings retain #3948's prior observations.

## Validation and remaining work

Both required lints pass. Final Stylelint, spelling, Token ownership,
`git diff --check` and `merge-loss` pass. The final focused related run passes
all 64 tests with retries disabled and one worker: U133 click targets (3),
U130 Tokens (5), U135 preferences (2), U136 daemon-exit observer (1), U137
Check observers (53).

`just capture U130,U131,U132,U133,U134,U135,U136,U137` was run, then interrupted
with exit 130 after 18 passing files; its incomplete suite is not a pass.
The paired observations above and the final focused run completed separately.

#3824 remains open for complete press/cancellation and extended Check observers,
shared inset/baseline, strict lint and all existing repairs, palette/system
accent, native material/fallback and Mac/performance observations. This slice
makes no native rendering or launch-performance claim.

## Current main integration

Clean merge `26138c1879fe584344992afd39b53b2254f010c9` includes main
`02bd2825b`; no authored row stylesheet changes in that merge. Fresh isolated
headless Chromium captures in the dedicated `fix4005` session are dark,
1512×950, device scale 1. Every existing Check passes on all five named seeds.
Readings and uncommitted images are under `artifacts/ux/U133/completion/`.

Select agent-3, then click agent-1's Pads disclosure: agent-1 has no background
image or focus-visible state; only agent-3 retains the wash. Keyboard focus on
error Agent agent-7 retains its red name (`rgb(255, 107, 107)`) and one wash.
The pointer and keyboard readings record these states.

The broad capture run on the superseded head was interrupted when the remote
branch advanced; no complete suite pass is claimed.

Both required lints and all 64 focused tests pass on this integration, with
one worker and retries disabled. The fresh drag recording decodes at 1512×950
with six frames after installing ffmpeg.

The dense seed's failed completion visibly reads “Completion refused. Retry
after reconnecting.” Every existing Check passes in that capture.
