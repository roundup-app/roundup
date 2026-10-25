# U131 / U133 completion

Runtime base: `46dcbf37f`. Runtime head: `a0cb11710`.
Observer: isolated headless Chromium, dark, 1512×950, device scale 1.
Readings: `completion.json`. Images, full readings and recordings remain
uncommitted under `artifacts/ux/U133/completion/{base,head}/`.

| Before | After |
| --- | --- |
| Enter leaves native buttons at opacity 1 | Native keys and pointer presses apply instant Token feedback |
| Checkbox/Switch have no visible press recipe | Their visible owner answers while the input retains native activation |
| Pointer cancellation can leave control-specific `:active` ink | One transient flag clears on release, cancellation, blur, exit and drag |
| Rail's new Glyph wrapper misses the merged inset rule | The wrapper reserves the existing 56 px title column |
| Shelf Kind marks sit 2.75–3 px below the title baseline | The visible marks align within 1 px; tick/disclosure geometry stays fixed |

Every sampled App title inset is 56 px after tree indentation. The largest
absolute visible-circle-edge/first-line-font-baseline difference is 0.359375 px.
The SVG circle's visible edge includes its stroke; animated interior paths do
not enlarge the mark. Plain Terminal tabs reserve the column and have no Kind
mark to compare. Canvas font metrics, Range and SVG geometry are read without
changing the page. The same alignment observer runs against both checkouts.

The control fixture is shared between checkouts; only the head installs the
feedback observer. First-frame readings use one requestAnimationFrame after
real pointerdown/keydown. Rail Return opens its destination and blurs before
that sample on both revisions: its cancellation is recorded separately, rather
than counted as a positive press measurement. Behavioral tests separately use
complete native key presses and count one action; raw held-key probes do not
substitute for activation tests.

Paired captures cover the five required seeds, dense Todos, visible
`Complete failed: Offline. Retry.`, Todo menu, Pad and Rail focus/selection/drag,
and Terminal tabs/Bubble. D2/D5/D6 pass in every App capture. No Check passing
on the baseline regresses. D12/D14 fail during Todo/Pad drag on both revisions.
The isolated native-control fixture retains baseline D3/D6/D8 failures; it is
not an App layout. Both drag recordings decode successfully.

D4 inspects the instant Token recipe; actual first-frame samples accompany it.
D7 keeps the old no-pressed-ground duty and checks state decoration separately
from the installed drag library's pointer geometry and browser reset rules.
D8 retains elevation/hairline duties and adds local inset/visible-mark readings.

## Validation

- 98 focused tests pass with retries disabled, including Rail/Todo drag and
  native activation/cancellation. After the final observer repair, all 53 U137
  Check tests pass again with retries disabled.
- The broad prescribed capture command completed 144 files before interruption.
  Its cold U463 first-run timeout passes alone with warm binaries and retries
  disabled. The broad run is incomplete, not a passing full-suite claim.
- `just lint-rust`, Stylelint, type checks, source lint, Token scan and
  `merge-loss` pass. `just lint-web` passes after main `9f0295fb6` brings
  #4098's size-ceiling repair. This PR authors no loop-machinery changes.
- PR #3948 is retained through #4005 and subsequent merged continuations;
  #4049's choice-machine repair is included. No existing test was cut: the
  edited choice test only narrows its blur target after adding fixture controls.

This completes #3824's scoped press/baseline slice. #4068–#4072 retain the
remaining whole-pass acceptance, including strict lint, palette/accent and
native material. This observer makes no native rendering or launch-cost claim.

## Reproduce

Serve the base and head worktrees on ports 5200 and 5199 after `pnpm install`.
Share the head's `ui/u133Fixture.tsx` with the base, removing its feedback import
and onMount registration; copy `testing/designChecks.ts` to the base as a
measurement-only module. From the repo root run:

```sh
pnpm --filter desktop exec python3 observers/U133/observe.py --browser agent-browser --output ../../artifacts/ux/U133/completion
```

`--side head` needs no base checkout. `--phase` limits observations to rows,
controls, failure or the Rail Return/blur probe. Keep the same renderer and
pixel ratio; `record start` recreates its context, so the driver restores dark
mode and viewport before recording the real drag.

## Concurrent fix integration

The merge retains the concurrent fix run's functional-selector matching and
text-entry/drag exclusions, drag-measurement regression and post-blur activation
probe. Feedback registration is consolidated at the App lifetime with one flag;
the duplicate keyboard-only installer and its `data-key-pressed` styles are
replaced by the pointer/key cancellation implementation measured here.

The concurrent `u133_release_away_does_not_activate` cases are covered by
`u133_release_away_cancels` for Button, Checkbox, Switch and Toggle, plus Tab.
Its blur case remains `u133_blur_clears_native_button_press`, including the next
activation. Check tests use the retained `data-pressed` recipe. No behavior is
retired; both runs' commits remain in the branch history.
