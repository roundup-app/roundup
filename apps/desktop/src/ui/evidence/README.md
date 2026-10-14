# App component foundation

Installed production package: `@ark-ui/solid` **5.39.3** (desktop manifest and `pnpm-lock.yaml`). Solid, vanilla CSS, `tokens.css` and all five button kinds are retained. Only CloseDialog is migrated; the fixture exercises Menu and Tooltip without migrating callers.

Implementation source: `5b02565152a3741d72ebc9d80789ff0e45b2e046`. Merge `965d2db7498a33e27208c03715a6a0855ca50fa2` adds only main's two specification files; production source is identical.

| Clause | Observer |
| --- | --- |
| U474 dependency, exports and IconButton name/type | `src/ui/u474_foundation.test.tsx`; desktop `typecheck` checks the positive and negative JSX fixture |
| U474 Dialog, AlertDialog, Menu and Tooltip behaviour | `src/ui/u474_browser.test.ts`, isolated headless agent-browser with a fresh profile and real Ark components |
| U475 focus wrapping, cancellation, one close call and visible failure | Individually named `u475_` tests in `src/header/u475_browser.test.ts`, tree-40, light/dark, 1280×800 and 1440×800 |
| U475 rendered Checks | `u475_close_dialog_checks`; every D1–D14 and D16 passes on the question and failed-close screen in all four combinations |
| U184 regression | Existing header tests; the outside-click test now uses the real browser instead of a jsdom click that omitted Ark's pointer sequence |
| Old trap deletion | `rg -n "Window capture runs before" src/header/CloseDialog.tsx` exits 1; the implementation contains no trap, capture listener or focus-restoration loop |

`just capture U475` writes before/question/failure PNGs and Check readings to `artifacts/ux/U475/`. The original `*-readings.json` envelopes are retained; paired before/question Check files contain their unchanged per-state maps. These are webview observations on a fake App seam, not a real Daemon stop or native rendering result. No Mac observation is claimed.

## Daemon budget

`daemon-perf.log` retains the full `just perf` output; `daemon-perf.json` retains its measurement JSON. The first observation used the library-installed working tree at parent `447c2aebe8a3bdc72137936d1a1a42bf1e912021`. All Daemon source and build inputs are identical to main `d5ada596` and to the implementation source above; this change touches no Rust or Daemon build file.

OS: Linux, x86_64, AMD EPYC 9V45, four available CPUs. Baseline: `crates/perf/budgets.json` on main `d5ada596`, the OS-level Linux baseline documented in `docs/perf.md`. The runner-class repair belongs to #1251.

The initial run exits **1**. Cold start is **42.550302 ms**, below 300 ms, and ten idle Agents add **2.59375 MB**, below 150 MB. The RSS regression ceiling is 1.810 MB and is missed. Ping, Rail-40, Terminal write and write-to-output regression gates also miss. `skipped` is empty: no regression gate was skipped, and no complete performance pass is claimed. Load is retained in the JSON.

#1629 is natively blocked by the existing #1251 repair Issue. These Daemon results do not measure the App dependency's cost and do not justify switching the selected library.

## Native observer still required

U473 has no native keystroke result for this implementation. R12 requires an explicit user request before anyone sets `ROUNDUP_ALLOW_WINDOW=1`; this Linux run does not run the native observer. On the final authorised Mac checkout, `pnpm install` followed by `ROUNDUP_ALLOW_WINDOW=1 just perf-keystroke` builds the probe App and runs its three observations. It opens a window over the user's screen and types into it. Retain the full output and measurement JSON: exit 0 passes, exit 1 misses a budget, and exit 2 requires repairing the observer. Apply `docs/perf.md`'s rerun rules before attributing a miss to Ark.
