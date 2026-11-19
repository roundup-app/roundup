# Z3788a addon compatibility on the 2026-11-16 xterm.js beta build

Observed 2026-11-19 for Issue #7542, on the xterm build PR #7541 put on main. All four requested addons coexist with patched xterm 6.1.0-beta.338, patched Fit 0.12.0-beta.334, patched Image 0.10.0-beta.333 and WebGL 0.20.0-beta.331 in isolated headless Chromium 147 on macOS. The probe is unchanged from the October run (`probeHash` in `environment.json` is equal) and passes 40 of 40 checks with DOM, WebGL and an actual WebGL context loss followed by DOM fallback. A second fresh install and fresh profile also pass 40 of 40. Of the 40 result rows, 38 equal the October rows on xterm 6.0.0; the other two differ only in the user agent and the early DOM FIFO samples. The nine `@xterm/*` packages come from one xterm.js build (`c9cc4785d24c9fad658627d5a458350d0baf3f1d`, npm `beta` dist-tag, published 2026-11-16). This is an upgrade-compatibility record: it adds no App feature and changes no Terminal behaviour.

| Capability | Observed |
| --- | --- |
| Search 0.17.0-beta.332 | Two `needle` occurrences among 100 numbered lines; next/previous select distinct original rows (buffer rows 4 and 94), missing query fails, no input emitted. |
| Serialize 0.15.0-beta.332 | Exact retained buffer strings and cursor restored into a fresh emulator at the same 80×24 grid (1336 serialized bytes), including wrapped Unicode and red text; later output occurs once. |
| Clipboard 0.3.0-beta.336 | One exact Unicode provider write. Provider catches a rejected write and parsing continues. A read query returns an empty OSC reply; the native-read sentinel is never called and its secret is absent. |
| Image 0.10.0-beta.333 | SIXEL 24×12 and IIP PNG 32×16 decode through the real addon. Output and input continue after resize, scroll and renderer loss. |
| Explicit image cache cap | 1 MB, 262144 pixels/image, 1 MiB protocol limits, size reports disabled. Twelve 256×256 PNG images saturate the FIFO at 0.786432 MB; every recorded usage stays below 1 MB. Disposing each Terminal clears addon storage. |
| Repository patches | The xterm (CSS and `xterm.mjs`), Fit and Image patches apply to isolated npm packages with `patch -p1`, exit 0, no rejects. The patched files are byte-identical by sha256 to those in `apps/desktop/node_modules/@xterm/*` (`installedHashesMatchApp`). Public Fit dimensions remain available (110×30). |
| Install | `npm ls` shows one xterm copy: every addon resolves `@xterm/xterm@6.1.0-beta.338`. Registry integrity of all seven xterm packages equals the integrity in `pnpm-lock.yaml`. |

| Addon | Checks | DOM | WebGL | Passed |
| --- | --- | --- | --- | --- |
| Search 0.17.0-beta.332 | 10 | 5 | 5 | 10 |
| Serialize 0.15.0-beta.332 | 6 | 3 | 3 | 6 |
| Clipboard 0.3.0-beta.336 | 6 | 3 | 3 | 6 |
| Image 0.10.0-beta.333 | 12 | 6 | 6 | 12 |
| Fit (patched) 0.12.0-beta.334 | 2 | 1 | 1 | 2 |
| WebGL (active canvas, context loss, DOM fallback) 0.20.0-beta.331 | 2 | 0 | 2 | 2 |
| xterm input after the above 6.1.0-beta.338 | 2 | 1 | 1 | 2 |
| Total | 40 | 19 | 21 | 40 |

The WebGL rows use Chromium's ANGLE SwiftShader software renderer (`environment.json` holds its unmasked renderer string), not a GPU or WKWebView claim. The image observer checks decoded canvases through the addon's public API; it does not judge visible image rendering. The clipboard provider is an explicit fixture, not Tauri: no native write or native clipboard permission pass is claimed. The read sentinel makes unexpected use of the browser's default provider observable. The provider's catch belongs in the existing Terminal clipboard-failure owner; the minified source of Clipboard 0.3.0-beta.336 still chains a rejected provider promise without a rejection handler. The probe does not load addon-ligatures, addon-unicode11 or the App's emulator wiring; CI's Terminal tests judge those.

The cap measures the addon's public image storage, not total resident memory. Decode buffers, WebGL atlases, canvas backing stores and WASM memory are outside that number. Ten idle Agents' extra RSS remains unmeasured, so this is no rule-7 pass. This is a compatibility probe, not a latency measurement.

## Production bytes

Two production builds on one macOS host (Vite 8.3.5, Node v22.18.0), one at a time: main `d53b12807` before #7541 (xterm 6.1.0-beta.336) and main `a7ef7ef0b` with #7541 (xterm 6.1.0-beta.338). The second build ran on the pre-merge branch commit `4669d4fef`, whose git tree equals `a7ef7ef0b`'s. Node gzip level 9, recursive static imports, each emitted JS file counted once. `pnpm --filter desktop check:startup` exits 0 at both against the unchanged `startup.json` ceiling of 1,000,000 gzip bytes.

| Revision | Entry chunk gzip | Entry chunk raw | Eager closure gzip | Eager closure raw | Lazy Terminal gzip | Lazy Terminal raw | WASM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| main `d53b12807` (before #7541) | 199,177 | 612,649 | 566,737 | 1,650,837 | 231,107 | 830,573 | none |
| main `a7ef7ef0b` (with #7541) | 199,180 | 612,649 | 566,740 | 1,650,837 | 273,356 | 1,016,331 | none |
| Change | +3 | 0 | +3 | 0 | +42,249 | +185,758 | |

The entry chunk is the file `index.html` loads; the eager closure is `check:startup`'s figure: that chunk plus every statically imported chunk (68 files at both revisions). The two entry chunks differ only in the hashed names of the emulator and TerminalPreview lazy chunks they import: raw size is identical and the 3 gzip bytes are name entropy. The scenario's strict 409,600-byte gzip ceiling is exceeded at both revisions (566,737 and 566,740); that oversize predates this change and is recorded, not presented as a pass. No xterm module is eager (`check:startup` fails an eager `@xterm/` module).

The lazy Terminal chunk grows by 42,249 gzip bytes, all outside the eager closure and loaded with Terminal use. The build's per-module rendered bytes (`release-modules.json`, indicative, not additive to the minified chunk) put the growth in addon-webgl (+131,377) and addon-ligatures (+160,187, the UMD bundle `apps/desktop/vite.config.ts` aliases to because the 0.11.0-beta.332 ESM bundle imports `node:diagnostics_channel`), partly offset by smaller search, unicode11 and clipboard bundles; xterm itself moves -682. `runtime-bytes.json` holds file lists, hashes and the per-package figures. These are macOS bytes; the October Linux figures are not comparable.

## Reproduce

Use Node 22 (observed v22.18.0, macOS arm64), pnpm 10.14.0 and repository agent-browser 0.27.0. `probe-lock.json` pins all isolated packages; `packages.json` records registry publication dates and integrity, and `environment.json` records base/source/installed hashes. Run only in a dedicated headless browser with a fresh profile.

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
patch -d "$probe_dir/node_modules/@xterm/xterm" -p1 < patches/@xterm__xterm@6.1.0-beta.338.patch
patch -d "$probe_dir/node_modules/@xterm/addon-fit" -p1 < patches/@xterm__addon-fit@0.12.0-beta.334.patch
patch -d "$probe_dir/node_modules/@xterm/addon-image" -p1 < patches/@xterm__addon-image@0.10.0-beta.333.patch
cp "$evidence/probe.js.txt" "$probe_dir/probe.js"
cp "$evidence/index.html.txt" "$probe_dir/index.html"
npm ls --prefix "$probe_dir" @xterm/xterm
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

Stop only that Vite server, then remove only the temporary directories this reproduction created. Browser-close or server-cleanup failure is a setup result (exit 2), never a pass. Run the commands with shell error checking: any install, patch, launch, extraction or JSON error is setup failure (exit 2). The final result validator returns 0 for all capability checks passing, 1 for a failed completed capability check, or 2 for a setup/parse timeout/incomplete action.

`result.json` is the first run. `reproduced-result.json` is a second run from a fresh `npm ci` and a fresh browser profile; `reproduction.json` records that its complete output is not equal to the first. They differ only in the second and third DOM FIFO samples (0.5308 and 0.792944 against 0.527488 and 0.789632 MB), by 0.003312 MB each: scaled image caches can be populated during rendering. Both converge to 0.786432 MB and stay below the same cap. No byte-identical reproduction is claimed.

## Reuse and integration

PR #7541 moved every `@xterm/*` package in `apps/desktop` to the `beta` dist-tag build named above, pinned exactly, renamed and rebased the xterm, Fit and Image patches onto the new versions, and pointed the `@xterm/addon-ligatures` alias at its UMD bundle. It added no runtime holder, parser, adapter or unused dependency, and changed no Terminal source except one comment in `apps/desktop/src/terminal/imageHarness.ts` that names the renamed Image patch. Staying on the mixed pins main had before it (WebGL 0.19.0, Search 0.16.0, Unicode11 0.9.0, Clipboard 0.2.0, xterm 6.1.0-beta.336) fails the Issue's one-build outcome. The maintained alternative [@xterm/headless](https://github.com/xtermjs/xterm.js/tree/c9cc4785d24c9fad658627d5a458350d0baf3f1d/headless) runs in Node.js and has no DOM/WebGL image renderer or focused browser selection, so it cannot supply this browser acceptance; its newest beta is 6.1.0-beta.336 (`alternative.json`).

## Terminal tests

CI's `check` judges the pushed head. On this Mac the Terminal suite's browser tests `u2680c`, `u2680d`, `u3529b`, `u3707`, `u5515d` and `u5549c` fail on main before and after #7541 alike, and Playwright WebKit segfaults at launch (`u4649b`). These are environment failures; no local pass of those tests is claimed.

## October record

The October 2026 record (xterm 6.0.0, Fit 0.11.0, WebGL 0.19.0, Search 0.16.0, Serialize 0.14.0, Clipboard 0.2.0, Image 0.9.0; 40 of 40 on Linux) is in git history before this evidence replaced it. `capture.py.txt` is that slice's OSC 52 real-Daemon capture script, unchanged, not rerun here and not tied to a package version; `probe.js.txt` and `index.html.txt` are the probe and its page, unchanged.
