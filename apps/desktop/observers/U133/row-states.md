# U133 row state observation

Acceptance: `scenarios/ui-visual.md`, “U133 press and row states extensions”.
Observer: isolated headless Chromium, dark, 1512×950, device scale 1.
Baseline: `568b3708fc` (full revision recorded by git in this report's first commit).
Captures and computed readings: `artifacts/ux/U133/{base,head}/`.
Paint is observed here, with no appearance unit assertions (rule 10).

| State | Baseline observation | Required result |
| --- | --- | --- |
| Selected Rail Agent | Accent stripe plus selected wash | One square selected wash |
| Keyboard-focused Rail Agent | No wash | Same selected wash |
| Focused Todo or Pad title | No wash | Same selected wash |
| Selected Todo | Wash, 2 px accent pseudo-element, 6 px radius | One square selected wash |
| Selected Pad | Wash, accent stripe, 6 px radius | One square selected wash |
| Selected and pointer-dragged Todo | Retains stripe/radius; backing changes to centre ground | Same cue and backing as selection |

Keyboard focus uses the App's ArrowDown navigation. Todo and Pad selection uses
the existing ⌘Return chord; pointer drag crosses Sortable's activation distance.
The drop destination is a separate object and keeps its placement marker.
These baseline observations fail U133's new clause even though existing D1–D14
and D16 pass on the five named seeds. Existing Checks do not measure this new
clause; their green result is only regression evidence.
