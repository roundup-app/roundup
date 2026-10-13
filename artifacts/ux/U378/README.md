# U378

```text
+ Agent | ▾
  defaults  Model + Effort → Add agent
                          Esc → discard choices
failed add → keep pair + error → retry
```

At the default 288 px Rail, the split keeps its Agent label, 16 px marks, two targets at least 24 px wide and 24 px high, a hairline divider and a 4 px gap from the Glyph. Open folder and Open in editor yield layout space through 360 px, remain in the Tab order and appear on focus. Below 220 px only the Agent label yields; targets and marks retain their dimensions.

The Model select ends long values with an ellipsis. Captures use 20 Models with 40-character labels in first-run, agents-10 and tree-40 at 1280×800 and 1440×800, light and dark, closed, open, changed and failed. Nested Workstreams retain at least a 16 px name column with no horizontal overflow.

U378's rendered tests assert the label, split dimensions, marks, divider, Glyph gap, select ellipsis, picker bounds and design Checks. Keyboard observers cover immediate add, picker add, Escape, Open folder and Open in editor. An isolated headless agent-browser session `builder-38457551532` inspected tree-40 at both viewport widths; all measured Checks passed at 1280×800. No native Mac observation is claimed.

All 60 refreshed head readings pass every measured design Check. The 163 px stress observer and both click-target observers pass in the final capture run.
