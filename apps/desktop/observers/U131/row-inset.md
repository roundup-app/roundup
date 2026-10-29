# U131 shared row inset

Acceptance: `scenarios/ui-visual.md`, “U131 row alignment extension (D8)”.
Continuation of #3948; #4005 already merged its row-state and pointer-focus
repairs. This slice owns the Shelf and Terminal-tab inset. Rail alignment and
the optical baseline measurement remain acceptance on #3824.

## Baseline

Main `6caf136e5e939f4694f436e40e9331c4727af1e4`, isolated headless Chromium,
dark, 1512×950, device scale 1. On `tree-40`, open the Overview's Unassigned
group. Measure each title from its own row edge, subtracting only
`(aria-level - 1) × 16` for the existing Todo tree indent.

| Before | After |
| --- | --- |
| Plain Todo title: 32 CSS px | 56 CSS px |
| Blocked Todo title: 56 CSS px after tree indent | 56 CSS px, with tick and blocker space retained |
| Done-fold title: 56 CSS px | 56 CSS px |
| Pad title: 32 CSS px; Terminal name: 21 CSS px | 56 CSS px each, including Terminal rename |

The change reserves the existing blocker row's leading space. It keeps the
tick-only Todo and its native target, the blocker mark and tree indentation.
Paint and geometry are critic observations; existing behavioral tests cover
Todo completion, Pad opening and Terminal selection/rename.

## Rendered comparison

`--row-text-inset` is 32 CSS px (U4707) in both schemes. Shelf Todo, Pad and done-fold
names share it. The nested blocked Todo keeps its existing 16 CSS px tree
indent. A Terminal tab's edge is included through `--flat-tab-edge`; an
inactive edge spacer adds no gap before its name. The rename field reserves
the same leading column.

The final runtime is `7d3938822`; its clean merge includes main `eb0a1f867`.
Paired observations use the baseline checkout on port 5200 and the
implementation checkout on port 5199, the same isolated Chromium session,
1512×950, device scale 1. Dark preference is set explicitly after starting a
recording, since that command creates a new browser context.

Artifacts are under `artifacts/ux/U131/inset/{base,head}/`: the five named
seeds, the dense Todo list, open Todo Drawer, Pad list, Terminal tabs and
rename, keyboard focus, Pad selection, visible failed completion and both
lists after a pointer drag/drop. The failure reads “Offline. Reconnect.”
The recordings show the pointer interaction; after-drop screenshots do not
claim a held drag pose or first-frame press timing. Images and videos are
uncommitted.

The paired readings and measured insets are summarized in `row-inset.json`.
All 16 pairs retain every passing Check; D2, D5 and D6 pass throughout. The
Pad list's existing D12 failure is 32 on base and 56 on head, including its
focus, selection and after-drop views. No Check was weakened.

Decoded PNG samples of the plain Todo, Pad and Terminal name have their first
ink pixel at local offset 56 on head (base: 32, 32 and 21). The scan compares
each title's first line to the adjacent neutral ground and counts a pixel
when a channel differs by more than four levels. This is a raster reading,
separate from the CSS text-box readings. Glyph optical baselines remain
unmeasured. Layout and paint remain critic evidence rather than appearance
assertions in unit tests.

The dark recordings decode at 1512×950: base 12.7 seconds/127 frames, head
12.0 seconds/120 frames. The initial browser setup before dark preference
took effect is trimmed (1.0 seconds on base, 0.8 on head); every retained
frame has the dark ground.

## Validation

Both post-merge lints, Token ownership and merge-loss pass. Focused coverage
on the integrated head verifies 116 tests with retries disabled: 115 passed
in the integrated run, and its resize observer passed alone after Vite's
dependency rebuild and reload completed. The Token-table test passes fresh.

The prescribed `just capture U130,U131,U132,U133,U134,U135,U136,U137` run
completed with 3,958 passed, 57 skipped and one failed Token-table test. The
edge Token was added after that test server started, leaving its cached CSS
behind the updated table. This broad run is not recorded as a green pass.
It also reported the resize test passing on retry; the final isolated run
above has retries disabled. CI judges a fresh run on the pushed head.

## Remaining acceptance

#3824 remains open for Rail integration, optical Glyph baseline measurement,
complete press/cancellation and extended Check observers, strict lint and all
existing repairs, palette/system accent, native material/fallback and the
Mac/performance observations. This slice changes no native window setup.

## Completion refresh

Fix run `builder-40191473795` merged main `eb4a16fdb` cleanly into
`56a96a70544c2c89a6e2170a2a655cca2375c1a4`. No runtime edit or conflict
resolution was needed. `completion.json` records the immutable revisions
and the Check comparison.

Fresh isolated headless agent-browser captures at 1512×950, dark, scale 1
are under `artifacts/ux/U131/completion/{base,head}/`. Eleven pairs cover
the five required seeds, dense plain/nested/long Todos, a selected Todo with
its Drawer, failed completion, Pads, a newly opened Terminal and rename.
Every previously passing Check remains passing; D2/D5/D6 pass throughout.
D12 still fails on both revisions when Pads are visible. The failure text
“Offline. Reconnect.” remains fully visible. Images remain uncommitted.

Measured local title offsets on this refresh:

| Surface | Main | Integrated head |
| --- | --- | --- |
| Plain / nested blocked Todo | 32 / 56 px | 56 / 56 px |
| Pad | 32 px | 56 px |
| Newly opened Terminal / rename | 9 / 21 px | 56 / 56 px |

Todo offsets subtract only the existing tree-depth indent. These are
rendered geometry readings; the earlier raster observation remains separate.

Both `just lint-web` and `just lint-rust` pass, including `ALL PROOFS CHECK`.
`merge-loss`, `git diff --check` and the paired capture delta pass. Seven
focused files pass all 160 tests with `--retry=0 --maxWorkers=1`: U130 Tokens,
U135 schemes, U137 Checks, Terminal tabs, Todo nesting/actions and Pad rename.
The prescribed broad capture invocation and broad related-style selection
were interrupted (exit 130), not reported as green; CI judges the full push.
The remaining acceptance above stays on #3824.
