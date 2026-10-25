# U130/U133 choice controls

Baseline: `235ba2d91d89ad7b449dea2a950cd37d0fa185c5`.
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
