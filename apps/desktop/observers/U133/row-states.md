# U133 row state observation

Acceptance: `scenarios/ui-visual.md`, “U133 press and row states extensions”.
Isolated headless Chromium 155, dark, 1512×950, device scale 1.
Baseline: `8b1b4144b7fb676a511a166740bf108a9f0145ae`.
Captured implementation: `0a603f25e9b0ab937a66fced88c3844f38b20872`.
Final integration checks: `6ffc9ac28fb6788cbdb194624b024fe83d5f4cca`.
The later clean merge changes no authored stylesheet in this observation.

| Interaction | Baseline | Implementation |
| --- | --- | --- |
| Selected Rail Agent | Accent stripe and selected wash | One square selected wash |
| Focused Rail Agent or Workstream | No wash | Same selected wash |
| Focused Todo or Pad | No wash | Same selected wash |
| Selected Todo | Wash, accent pseudo-element and 6 px radius | One square selected wash |
| Selected Pad | Wash, stripe and 6 px radius | One square selected wash |
| Selected and dragged Todo/Pad | Press ink or dimming; centre ground beneath wash | Rest ink/opacity, selected wash over the original region ground |
| Owned Todo or Pad focus | No wash | One wash on the full-width leaf, none on its nested row |
| Owned Todo drag | Lifted row uses centre ground | One wash over Rail ground; no second wash on the leaf |
| Owned-items disclosure after paint, then Space | Drops focus and stays closed | Keeps focus and opens its rows |

`row-states.json` records the computed readings and Check deltas for 25 paired
states, including all five named seeds, a fully visible failed completion on the
dense seed, owner picker, Todo Drawer and Terminal Bubble. Zero existing Check
results regress. All existing Checks pass on the five named seeds. D12 fails on
the Pad list in both revisions; D12/D14 also fail during held Shelf drags in both.
These are regression readings, not completion of the new Check extensions.

The before-image disclosure is expanded through its DOM click handler to observe
the owned rows despite main's focus defect. The implementation uses native Space.
`u133_owned_items_keep_keyboard_focus_through_paint` focuses the disclosure, waits
for two animation frames and activates it: red before the repair, green after.
Its assertions concern opening rows, not appearance. The two existing U133 tests
still prove native Export semantics and the disconnected controls' aria contract.

Validation on the integrated source: 17 focused tests pass with retries disabled;
`just lint-web`, `just lint-rust`, Token ownership and `merge-loss` pass. The full
`just capture 'U130,U131,U132,U133,U134,U135,U136,U137'` run reports 3,797 passed,
4 failed and 57 skipped. Its four failing cases pass in the final focused run.
The U348 cleanup timeout also reproduces on unchanged main; its quiet rerun passes.

Paired PNGs/readings stay uncommitted under
`artifacts/ux/U133/row-cues/{base,head}/`; twelve selected after-images are under
`artifacts/ux/U133/after/` for workflow attachment. The recording observer returns
“No frames captured” after installing ffmpeg; no video pass is claimed.

This is a bounded U133 slice. #3824 retains complete press/extended Check observers,
shared inset/baseline, strict lint and its repairs, palette/system accent, native
material and the Mac/performance observations. No native or performance pass is
inferred from these browser captures.

## Integrated completion check

Main `9c8abc943b44186fa3b9aee4682c09cf3c03d652` merged cleanly at
`4bc4543d071d982cae1b18646e59f461fa1c38fd`; no authored stylesheet changed.
All 64 focused tests pass with retries disabled: U133 click targets (3),
U130 Tokens (5), U135 preferences (2), U136 daemon-exit observer (1) and
U137 Check observers (53).

Fresh isolated headless Chromium 155 captures at 1512×950 in dark pass every
existing Check on all five named seeds, selected/focused Rail rows and the dense
failed completion. Its visible recovery text reads “Completion refused. Retry
after reconnecting.” Space opens the focused owned-items disclosure.
PNG files and per-seed readings remain under `artifacts/ux/U133/after/integrated-*`.
Recording again returns “No frames captured” after ffmpeg installation; no video
pass is claimed. The original paired row-state evidence above remains applicable.

`pnpm install --frozen-lockfile`, `just lint-web`, `just lint-rust`,
`git diff --check` and `loop/rules.sh merge-loss` pass on this integration.
