# U130 dimensional ownership

Acceptance: `scenarios/ui-visual.md`, “U130 Token ownership and lint extension”.
Continuation of #3948 through merged #4005 and #4013. Their pointer-focus
repair, row cues and shared insets remain intact.

Baseline: main `ab3a3041f`. An in-process Stylelint audit of authored CSS,
using `unit-disallowed-list: [px, ms, s]` with only `tokens.css` exempt,
reports 132 diagnostics. Instant durations, border/mark widths, fixed panel
geometry and zero lengths inside typed calculations still use raw units.

This slice moves those values to Tokens and existing space steps. It enables
no strict rule: importance, selector and colour repairs must precede the
complete gate. The Issue remains open for that gate, complete press and
extended Check observers, optical baselines, palette/accent, native material,
Mac observations and same-host performance evidence.

Rendered observations and validation follow after implementation. No native
or performance result is claimed.
