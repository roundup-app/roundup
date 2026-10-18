P2544a enables Crepe’s existing block-edit feature; #2552 stays open for P2544b–P2544e.

```text
/ → pointer or arrow selection → block
handle → reordered paragraphs → blur → persisted order
```

Paired 1512×950 light/dark `tree-40` captures use baseline `a611aba5151415c2d45a80e4f2c8936208576c1a` and Pad source `022c8d490e8aa30e23ae6536335f4bf0b4785b41`. The portal wrapper is transparent, keeping the App visible beside the Drawer. `observe.py` reproduces the open editor, slash menu, handle and rejected-save states with Vite development servers on ports 5201/5202. `delta.txt` records exit 0: no passing Check regresses. D1/D2/D6/D7/D10 fail on both sources; D5 passes. Saved status belongs to the next slice.

All 138 Pad tests pass, including the three headless slash/drag/read-only observers (`resume-pad-tests.json`). Rust lint and proofs pass. Web lint fails only on main’s two Todo spacing errors (#2590). The broader related run records 1,534 passed, 13 failed and three pending; nine failures belong to #2595’s shared painted Checks. U194/U351/U356 subsequently pass all four tests (`resume-startup-retry.json`). U166/U176 then pass all three tests (`resume-remaining-retry.json`), leaving only the nine shared painted-Check failures. Full results and commands are retained in the `resume-*.json` files.

The idle-host 1,000-key observer passes: baseline p95 14.7 ms, head 14.9 ms (about 1.4% slower). `perf.json` holds all 2,000 raw samples, full source hashes and command. Both sources use the same isolated Chromium host, 1512×950 viewport, Vite development mode and 100-paragraph/table/Mermaid/Excalidraw fixture; no native timing claim. The failed concurrent-suite measurement (15.1/17.3 ms) remains in `perf-contended.json`; interrupted/setup observers remain in `resume-observer-failures.json`.

#2552 is blocked by the existing shared Check repair #2595. Autosave, Saved status, source-range reconciliation, Revision guards and full P2544e real-Daemon/visual-block acceptance remain on that Issue. No Mac observation or product decision is pending.
