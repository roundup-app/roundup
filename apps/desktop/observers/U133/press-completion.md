# U131 / U133 / U137 completion

Runtime: `b4110f46fefc0a20cb051cec5c63d82dbabb7b01`.
Baseline: `ec105c209aa1f26ad21af2c8fc2be282327879aa`.
Observer: isolated headless Chromium, dark, 1512×950, fresh profiles.
Artifacts: `artifacts/ux/U133/finish/{base,head}/`; images and videos are uncommitted.

| Observation | Baseline | Runtime |
| --- | --- | --- |
| Button / Toggle / Tab, Enter, first frame | Opacity 1 | Token opacity 0.9 |
| Checkbox / Switch, Space, first frame | Opacity 1 | Token opacity 0.9 |
| Release and blur | Restored | Restored; no retained transient attribute |
| Rail title local inset, less tree indentation | 44 px | Shared 56 px |
| Shelf Kind Glyph bottom to first-line text baseline | 2.75 px | 0.75 px |
| Rail Kind Glyph bottom to first-line text baseline | 0.36 px | 0.36 px |

The native browser and Ark still own activation. The document observer only marks
keyboard paint; it never clicks, prevents an event, moves focus or sends a command.
Checkbox/Switch paint covers their visible label and mark. Pointer press remains
native `:active`; its blur and release restore the resting style. Every feedback
change is instant, including reduced motion; no motion engine or tween is added.

The original raw-key activation test used a driver command that omits the native
key code/text. Complete `press` events prove activation; raw down/up events record
first-frame paint and blur separately. Ark tab controls expose `data-value`, not
`value`. Numeric call counts replace draft text assertions. Paint assertions move
to this rendered observer; no behavioral case is retired or duplicated.

D4 retains missing-Glyph detection and checks Token press declarations. D7 retains
pressed-ground rejection and checks one row cue. D8 retains elevation, border and
nested-filter checks and measures local text insets and visible SVG mark baselines.
Native selector matching handles functional selector lists; no selector parser,
DOM clone or synthetic production event is introduced. Canvas font metrics and the
SVG circle's stroked bounds measure the mark rather than its square SVG box.

Paired first-run, agents-10, tree-40, daemon-exits, conflict and dense-failure
captures pass every Check, including D2/D5/D6. The dense failure reads
“Daemon exited 1” with its Reopen action. The existing 53 Check tests and 24 control
activation/cancellation tests pass; both required lints pass. Full capture-suite
results are recorded separately from those focused passes.

P11 gate: keyboard paint ignores text-entry fields and changes no input, target or
submission. Its observer is the existing native/Ark activation seam, including
release away, blur and one action per complete native activation. This is the
Understand/Intervene journey's control-feedback slice; it claims no new native
material, palette or Mac observation.

## Bubble regression repair

Baseline: `dd65aebab`; runtime: `799315c03`. Isolated headless Chromium,
dark, 1512×950; paired artifacts: `artifacts/ux/U133/fix-4091/{base,head}/`.

| Observation | Before | After |
| --- | --- | --- |
| Bubble D7 | Redundant active background declaration fails | Resting surface retained; press changes ink/opacity |
| Terminal-tab title inset | 51 px | Shared 56 px, counting the leading padding and gap |
| Bubble D10 | D7/D8 fail | Every Check passes |
| Dense rows and visible Daemon failure | Every Check passes | Every Check passes; failure and Reopen remain visible |

The Check implementations and thresholds are unchanged. The paired delta passes,
including D2/D5/D6. All 79 focused tests pass with retries disabled: U3707's
light/dark/higher-contrast observations, 54 Check tests and 24 control activation,
release and cancellation tests. These results are separate from the broad capture
suite and its reporting-test timeout.
The prescribed broad capture rerun passed both reporting tests, then was
interrupted during the desktop suite; it is not a complete-suite pass.
