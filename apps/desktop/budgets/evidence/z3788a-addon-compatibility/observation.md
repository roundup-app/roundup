# Z3788a addon compatibility before adoption

All four requested addons coexist with patched xterm 6.0.0, patched Fit 0.11.0 and WebGL 0.19.0 in isolated headless Chromium. The probe passes 40 checks with DOM, WebGL and an actual WebGL context loss followed by DOM fallback. This completes a pre-adoption compatibility investigation; it does not deliver the App features. Keep #3853 open.

| Capability | Observed |
| --- | --- |
| Search 0.16.0 | Two `needle` occurrences among 100 numbered lines; next/previous select distinct original rows, missing query fails, no input emitted. |
| Serialize 0.14.0 | Exact retained buffer strings and cursor restored into a fresh emulator at the same 80×24 grid, including wrapped Unicode and red text; later output occurs once. |
| Clipboard 0.2.0 | One exact Unicode provider write. Provider catches a rejected write and parsing continues. A read query returns an empty OSC reply; the native-read sentinel is never called and its secret is absent. |
| Image 0.9.0 | SIXEL 24×12 and IIP PNG 32×16 decode through the real addon. Output and input continue after resize, scroll and renderer loss. |
| Explicit image cache cap | 1 MB, 262144 pixels/image, 1 MiB protocol limits, size reports disabled. Twelve 256×256 PNG images saturate the FIFO at 0.786432 MB; every recorded usage stays below 1 MB. Disposing each Terminal clears addon storage. |
| Repository patches | Both xterm CSS and Fit patches applied to isolated npm packages. Public Fit dimensions remain available. Runtime dependencies are unchanged. |

The WebGL row uses Chromium's ANGLE SwiftShader software renderer, not a GPU or WKWebView claim. The image observer checks decoded canvases through the addon's public API; it does not judge visible image rendering. The clipboard provider is an explicit fixture, not Tauri: no native write or native clipboard permission pass is claimed. The read sentinel makes unexpected use of the browser's default provider observable. The provider's catch belongs in the existing Terminal clipboard-failure owner when integrated; addon source chains a rejected provider promise without a rejection handler.

The cap measures the addon's public image storage, not total resident memory. Decode buffers, WebGL atlases, canvas backing stores and WASM memory are outside that number. Ten idle Agents' extra RSS remains unmeasured, so this is no rule-7 pass. Production entry/static closure, lazy Terminal and transitive WASM bytes likewise require paired production builds after integration; tarball sizes are not substituted.

## Reproduce

Use Node 22.23.3, pnpm 10.14.0 and repository agent-browser 0.27.0. `probe-lock.json` pins all isolated packages; `packages.json` records registry publication dates and integrity, and `environment.json` records base/source/installed hashes. Run only in a dedicated headless browser with a fresh profile.

From the repository root:

```sh
set -Ee
trap 'exit 2' ERR
evidence="$PWD/apps/desktop/budgets/evidence/z3788a-addon-compatibility"
probe_dir=$(mktemp -d)
cp "$evidence/probe-lock.json" "$probe_dir/package-lock.json"
node --input-type=module - "$probe_dir" <<'JS'
import fs from 'node:fs';
const dir = process.argv[2];
const lock = JSON.parse(fs.readFileSync(`${dir}/package-lock.json`, 'utf8'));
fs.writeFileSync(`${dir}/package.json`, JSON.stringify({private:true,type:'module',dependencies:lock.packages[''].dependencies}));
JS
npm ci --prefix "$probe_dir" --ignore-scripts
patch -d "$probe_dir/node_modules/@xterm/xterm" -p1 < patches/@xterm__xterm@6.0.0.patch
patch -d "$probe_dir/node_modules/@xterm/addon-fit" -p1 < patches/@xterm__addon-fit@0.11.0.patch
cp "$evidence/probe.js.txt" "$probe_dir/probe.js"
cp "$evidence/index.html.txt" "$probe_dir/index.html"
(cd "$probe_dir" && ./node_modules/.bin/vite --host 127.0.0.1 --port 5238 --strictPort)
```

Leave that server in its own terminal. In another shell, use a unique session and a fresh temporary browser profile:

```sh
set -Ee
trap 'exit 2' ERR
probe_profile=$(mktemp -d)
pnpm exec agent-browser --session z3788a-reproduce --profile "$probe_profile" --args '--enable-webgl,--use-gl=angle,--use-angle=swiftshader,--enable-unsafe-swiftshader' open http://127.0.0.1:5238
pnpm exec agent-browser --session z3788a-reproduce set viewport 1512 950
pnpm exec agent-browser --session z3788a-reproduce reload
pnpm exec agent-browser --session z3788a-reproduce eval 'window.probeDone' > /tmp/z3788a-result.json
pnpm exec agent-browser --session z3788a-reproduce close
node --input-type=module - <<'JS' || exit "$?"
import fs from 'node:fs';
const result = JSON.parse(fs.readFileSync('/tmp/z3788a-result.json', 'utf8'));
if (![0, 1, 2].includes(result.exit) || !Array.isArray(result.rows) || result.rows.length !== 40) process.exit(2);
console.log(result.rows.filter(row => !row.pass));
process.exit(result.exit);
JS
```

Stop only that Vite server, then remove only the temporary directories this reproduction created. Browser-close or server-cleanup failure is a setup result (exit 2), never a pass. Run the commands with shell error checking: any install, patch, launch, extraction or JSON error is setup failure (exit 2). The final result validator returns 0 for all capability checks passing, 1 for a failed completed capability check, or 2 for a setup/parse timeout/incomplete action. This is a compatibility probe, not a latency or production-byte measurement; it makes no before/after budget claim.

`initial-result.json` retains the failed first observer: canvas identity was wrongly treated as image identity, and context loss queried the link-layer canvas instead of the WebGL canvas. The corrected probe identifies decoded images by distinct dimensions and finds the actual WebGL context. These were observer failures (exit 2), not evidence against the libraries. The final probe's source and hash accompany its raw result. A second fresh `npm ci` and dedicated fresh browser profile pass all 40 checks (`reproduced-result.json`). Complete outputs differ only in the first three DOM FIFO samples by 0.003312 MB; scaled image caches can be populated during rendering. Both converge to 0.786432 MB and stay below the same cap. `reproduction.json` records that full-result inequality honestly; no byte-identical reproduction is claimed.

## Reuse and integration

The installed App already uses xterm 6.0.0, WebGL 0.19.0, Fit 0.11.0 and Unicode11 0.9.0. Its `emulator.ts` owns rendering/fit/context loss; `screens.ts` owns snapshot ordering and per-Terminal clipboard failures. This probe adds no runtime holder, parser, adapter or unused App dependency. No custom implementation is deleted because none of the four requested capabilities exists in the current browser emulator.

Selected candidates are the [xterm addons published in the 6.0.0 release](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0), 2025-12-22, with exact source/integrity evidence in `packages.json`. They expose the existing buffer and clipboard provider seams directly. The maintained alternative [@xterm/headless 6.0.0](https://github.com/xtermjs/xterm.js/tree/6.0.0/headless), also published 2025-12-22, runs in Node.js and has no DOM/WebGL image renderer or focused browser selection; it cannot supply this browser acceptance. Its registry metadata is in `alternative.json`. Browser Clipboard supplies copy but lacks terminal OSC parsing, search, serialization and inline image storage; granting its read capability would violate this acceptance. No alternative parser is introduced.

## Regression and remaining acceptance

All 29 existing tests pass in `u102_emulator.test.ts`, `u103_snapshot.test.tsx` and `u103_webgl_reflow.test.tsx`; `regression.json` retains identities/results. No product source or test changes, no new duplicate test, and no visible App change is claimed. Existing input, fit, selection, context-loss and snapshot ordering owners stay intact.

Remaining on #3853: integrate Find and query retention, serialize with authoritative Daemon snapshot offsets/reload recovery, route copy/failure through the real App clipboard owner, adopt bounded images lazily, prove native copy authority and ten-Agent memory, record production entry/lazy/WASM bytes, then make required real-Daemon captures. The Intervene journey, P1/P3/P9/P11 and D2/D5/D6 still require their App observers after integration. Z3788d's valid rendered list measurements remain separate; no virtualization is authorized or installed.

`just ready` exits 0, including web/Rust lints, proofs, workflow checks, trailers, frozen checks and N7. The final report boundary lint also exits 0 after correcting two spelling matches. `validation.json` records these exits; merge-loss, vocabulary and whitespace checks pass.

## Continued verification

The replacement for closed PR #4312 starts at its final head `07189f34309cc8f2504e39a7eb78e9b844ca21de`, which already removed the unrelated recovery, styling and browser-test changes. A clean merge of main `02dd47127` leaves only this evidence directory in the diff; merge-loss passes. The original 13 evidence files were unchanged before this continuation.

A fresh isolated installation, patched packages and fresh dedicated headless Chromium profile at 1512×950 reproduce all 40 checks (`continued-result.json`). All 29 existing emulator/snapshot/renderer-recovery tests pass again. The dedicated browser and probe server are closed. `continued-validation.json` records the revision pair and results. This does not extend the native, rendering, memory or production-byte claims above.

After a further clean merge of main `eb7397cfb`, `just ready` exits 0: web/Rust lints, types, proofs and mutation checks, trailers, frozen checks, 36 workflow tests and N7 pass. App source still equals main, and merge-loss passes. The first verification caught escaped Unicode in the new JSON evidence; readable Unicode repairs it without changing decoded values. An interrupted lint left a temporary test fixture, removed before the complete passing rerun. Both repaired attempts are recorded in `continued-validation.json`.
