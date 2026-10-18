# P2544a critic fix

Baseline: cf5dffc9818b91a0d0dbc7bf37516328f77abd93.
Head: 1c70f63a5 plus clean merge of origin/main 27c8d7878.

Isolated headless Chromium, tree-40, 1512×950, light and dark.
Opened Pad, slash menu, ArrowDown, block handle and injected save failure.
The first head navigation timed out during concurrent broader tests; the isolated head retry completed.
Screenshots and D1–D14 readings are paired in base/ and head/.
delta.txt: exit 0, no regression. D1, D2, D6, D7 and D10 remain failing;
D3, D4, D5, D8, D9 and D11–D14 remain passing.

The selected slash item uses accent ink on its glyph, body-weight text, and no hover box.
Redundant group headings are removed. Both ownership states use the same prose gutter.
The browser observer p2544a_slash_menu_pointer_and_keys asserts the listbox,
option, selected state and editor active descendant on opening and ArrowDown,
then removal on Escape. All 138 Pad tests pass, including all three P2544a browser tests.
Both lints, message proofs and merge-loss pass after the clean main merge.
