P2544a enables Crepe’s existing block-edit feature. #2552 remains open for P2544b–P2544e.

```text
/ → pointer or arrow selection → block
handle → reordered paragraphs → blur → persisted order
```

Paired 1512×950 light/dark `tree-40` captures use baseline `a611aba5151415c2d45a80e4f2c8936208576c1a` and Pad source `022c8d490e8aa30e23ae6536335f4bf0b4785b41`. The head fixes the inherited Milkdown background on the portal wrapper, so the App stays visible beside the Drawer. `observe.py` reproduces the open editor, slash menu, handle and rejected-save states with Vite development servers on ports 5201/5202; only its own headless session is opened and closed. `delta.txt` and `delta-exit.json` record exit 0: no passing Check regresses. D1/D2/D6/D7/D10 remain failing on both sources; D5 passes. No saved-status claim is made in this first slice.

The three isolated browser observers exercise pointer/ArrowDown/ArrowUp/Enter selection, Escape and continued typing, dragging with saved order, and Agent-owned text/handle/write refusal. The earlier red/green commits and test report remain in this branch. Current validation and raw observer failures are recorded beside this file. `just lint-web` currently fails only on the two pre-existing Todo callback spacing errors in main, already owned by PR #2590; the Pad callback spacing is repaired here. No shared implementation or Check is weakened.

`perf.py` measures 1,000 trusted prose keys per source in a Pad with 100 paragraphs, a table, Mermaid and Excalidraw. It records every keydown-to-next-animation-frame sample, p95, command and source hash in `perf.json`. This is the same isolated Chromium host, viewport and Vite development mode, with no native timing claim. `resume-observer-failures.json` retains setup/session failures rather than treating interrupted observers as passes.

Autosave, Saved status, source-range reconciliation, Revision guards and the full P2544e real-Daemon/visual-block acceptance remain on #2552. No Mac observation is requested.
