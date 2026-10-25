# U133 press completion

Baseline: `46dcbf37f`, isolated headless Chromium, dark, 1512×950.

A held Enter on a native button activates it but leaves `:active` false and
computed opacity at 1. Checkbox and Switch have no transient press declaration.
The existing choice-control repair from #4049 is retained. PR #3948's final
head is an ancestor through #4005; its pointer-focus repair is on this baseline.

The behavioral seam is the shared Ark/native controls in `ui/u133.html`, the
same seam U133 specifies. Action counts measure native activation; rendered
readings measure first-frame feedback separately from behavioral tests.
