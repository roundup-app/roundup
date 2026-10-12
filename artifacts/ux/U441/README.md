# U441 Token evidence

Baseline: main ad2f80e84230c41e5150c7fecc9ca6378971e7ac. Head: the source in this PR. Chromium uses a fresh isolated profile.

Both schemes, normal/more contrast, 1280×820 and 700×800: rest, hover, selected, selected hover, close hover, pressed, disabled, keyboard focus, rename, overflow and failure/reopen. The Rail, centre pane, Shelf, Drawer, tooltip and close dialog are measured before and after the contract. The existing U179–U186 tests remain unchanged.

Each state compares every passing Check on the baseline against the head. A `-main` image/check pair uses the baseline styles on the same rendered DOM and interaction state; its unmarked pair uses the head. JSON colour rows retain unrounded composited channels and text/selected contrast readings. The seed matrix covers first-run, agents-10, tree-40 and three Projects.

The contrast fixture temporarily draws a 1 px Token border on the existing tabs, so its actual computed border colour is measured. Overflow measurement constrains only the fixture's strip width. Neither changes runtime geometry. The seed matrix and behaviour test use runtime geometry. U440, U442 and U443 remain #1093's work.

`tree-40` retains its baseline D14 failure (unequal Shelf row gaps); selected pointer and keyboard press retains every passing baseline Check with the repaired opaque Token. These captures show the webview, not native macOS behaviour.
