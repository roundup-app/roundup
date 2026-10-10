# U136 baseline

Base: `3541c8a7^` (main before U130's `tokens.css`), with `testing/checks.ts`, `contrast.ts` and `lookLiterals.ts` from `origin/main` (7d225b31) copied in, an empty `tokens.css` and `window.__checks` wired in `testing/harness.tsx`, because base has no D-checks. Chromium headless on Linux through `just harness` seeds `first-run`, `agents-10`, `tree-40`, `daemon-exits`, `conflict`, at 1280x800, light and dark. 700x800 was not captured. Linux only.

`loop/rules.sh delta base head` exits 0 (`delta.txt`, 100 comparisons): 54 `fixed`, 22 `still-passing`, 24 `still-failing`, **0 `regressed`**.

## Head recaptured

Head: `origin/main` 55717e63 (after #750 fixed D2 on `tree-40`). Same method, one fresh headless session per seed and scheme, `window.__checks()` read on the rendered page: D1 to D10 `pass` on all ten captures (five seeds, light and dark). `loop/rules.sh delta base head` exits 0 (`delta.txt`, 100 comparisons): 78 `fixed`, 22 `still-passing`, 0 `still-failing`, **0 `regressed`**.
