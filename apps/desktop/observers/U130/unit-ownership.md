# U130 dimensional ownership

Acceptance: `scenarios/ui-visual.md`, “U130 Token ownership and lint extension”.
This continues #3948 through merged #4005 and #4013; their row-state repairs
and shared insets remain intact.

Baseline: main `ab3a3041fbb91b1904296d0383562fbf11e742fd`.
Runtime: `a41959a5923fb10b057ddd37625293bdde3877ca`.

An in-process Stylelint audit reads every authored CSS file with
`unit-disallowed-list: [px, ms, s]`, exempting only `tokens.css`.

| Before | After |
| --- | --- |
| 132 unit diagnostics | 0 unit diagnostics |
| Local geometry and instant duration literals | Shared Tokens and existing space steps |

Fixed panel geometry, strokes, resize marks and instant durations now belong
to `tokens.css`. Typed zero lengths use `calc(0 * var(--space-1))` where a
calculation needs a length rather than a number. Numeric values are unchanged.

The audit rule misses five literal `px` container-query conditions in
`rail/styles.css`. The previous run's Issue comment counted six; the final
source count is five. They remain unchanged: custom properties cannot supply
size-query thresholds. This slice enables no strict rule. The complete gate
still requires these conditions and every importance, selector and colour hit
to be repaired together, without suppressions.

## Rendered comparison

One isolated headless agent-browser session, dark, 1512×950, device scale 1,
compares the baseline checkout on port 5200 with the runtime on port 5199.
The extra-state probes clear only that test origin's local/session storage
before reloading; no personal profile or desktop connection is used.

Paired captures cover `first-run`, `agents-10`, `tree-40`, `daemon-exits` and
`conflict`; dense plain, nested and long Todos; failed completion; an open
Todo Drawer; Pads; a new Terminal; Help; and the assignment menu.
The failure reads “Offline. Reconnect.” in full on the dense seed.

`unit-ownership.json` records each pair's Check comparison and visible-element
counts. The computed probe reads bounding rectangles, colour, background,
borders, padding, margin, gap, minimum/maximum dimensions, durations and
transforms. The only differing elements are rotating `.working-arc` marks
sampled at different animation frames; their colours and durations agree.
Every other measured element agrees exactly.

Every passing Check remains passing; D2/D5/D6 pass throughout. D12 retains
its existing value-56 failure when Pads are visible, including the Terminal
view. No Check is weakened. These are rendered observations, not appearance
assertions in unit tests.

PNG images and full computed/Check readings remain uncommitted under
`artifacts/ux/U130/units/{base,head}/`. This slice makes no native material,
first-frame press, complete interaction-state or performance claim.

## Validation

Both `just lint-web` and `just lint-rust` pass, including `ALL PROOFS CHECK`.
Stylelint, Token ownership, merge-loss and `git diff --check` pass.
The initial broad related-test selection was interrupted after ten passing
files to run the prescribed full capture suite instead; it is not a full pass.

## Remaining acceptance

#3824 remains open for the complete strict gate and fixture matrix, Rail
alignment and optical baselines, complete press/cancellation and extended
Check observers, palette/system accent, native material/fallback, and Mac
and same-host performance observations. This slice changes no native setup.
