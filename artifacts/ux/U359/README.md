# U359 rendered observer

Headless Chromium on a fresh profile, driven by `apps/desktop/src/testing/u359_rows.test.ts` over `just harness` pages: `tree-40`, `agents-10` and `first-run`, light and dark, at 1280×820 and 700×800. No native Mac capture; the WKWebView rendering stays the user's `just app` observation.

Each `<seed>-<scheme>-<w>x<h>.checks.json` is the complete `window.__checks()` with the worst case added (a 300-character Todo title, ten open blockers, a Home that is a Workstream with a 60-character name, a 120-character Pad name); D2, D12, D13 and D14 pass on every screen. Each `.rows.json` holds the row boxes, Glyph and text x. `first-run` has no Shelf row, so D12 to D14 pass with nothing to measure.
