P2544a is blocked by [#2578](https://github.com/saadshahd/roundup/issues/2578); this evidence does not complete #2552.

```text
Crepe slash/drag works → shared D1/D4/D8 repair (#2578) → resume #2552
```

The isolated browser tests pass: pointer and ArrowDown/ArrowUp/Enter heading selection, Escape retaining text and continued typing, paragraph dragging with persisted order, and read-only text/handle/write refusal. The Pad suite passes 137 tests. Both `just lint-web` and `just lint-rust` pass. `tests.json` preserves the related suite's failures: nine D10 failures in U137 caused by D1 reading authored zero radii back as CSSOM `0px`, plus a U351 startup-hook timeout. No tests were weakened.

`base/` and `head/` hold paired 1512×950 light/dark `tree-40` captures with the editor open, slash menu, paragraph handle and a visible rejected save. Baseline source is `a46839b7fe00237aa51f86c696b58081dccfaee8`; head Pad source is `d47cbf5d3a21af9ad89a77e737291fe1193480cd`. `observe.py` reproduces them with baseline/head Vite development servers on ports 5201/5202. It creates and closes only its own headless agent-browser session.

`delta.txt` and `delta-exit.json` record exit 1: D8 regresses only with the floating menu open, in both schemes. The menu uses the recorded token shadow, but the shared predicate permits shadows only under `aside` or on `.bubble`. The default non-portal library menu instead makes D4 classify its category labels as item Kind rows. D1, D2, D6, D7 and D10 already fail in the paired open-editor baseline; no passing observation is represented as a pass here.

The Pad performance observer uses 100 paragraphs, a table, Mermaid and Excalidraw, the same headless Chromium host, viewport and Vite development mode, and 1,000 trusted `x` key presses per source. Head p95 is 15.2 ms; baseline p95 is 16.1 ms. `perf.json` holds all 2,000 raw samples, the command, source labels and their correction, and results. These are keydown-to-next-animation-frame observations, with no native timing claim. Other test processes were running on this host. The first `keyboard type` attempt could not complete because that CLI operation produced no keydown events in a separate probe; `perf-input-failure.json` preserves the observer failure. `perf.py` uses `press` for real key events and reproduces the final measurement.

Autosave, Saved status, source-range reconciliation, Revision guards and the full P2544e real-Daemon/visual-block acceptance remain on #2552. No Mac observation is requested.
