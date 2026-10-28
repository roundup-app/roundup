# Terminal typography (U4456)

Terminal output uses Fira Code 6.2, replacing the JetBrains Mono font files.
The unmodified regular (400) and bold (700) WOFF2 files, OFL notice, upstream
release URL and SHA-256 hashes are in
`apps/desktop/public/fonts/fira-code/`. The original JetBrains Mono licence
notice remains alongside it. Fira Code supplies no italic files: browser font
synthesis renders italic and bold italic from the bundled faces. The emulator
requests all four style/weight combinations before its first authoritative fit.
Local App URLs have no `local()` or remote font source; other App typography
keeps its existing stack. xterm's normal/bold defaults already select 400/700.

## Metrics

| Token | xterm option | Value |
| --- | --- | --- |
| `--font-terminal` | `fontFamily` | `"Fira Code", ui-monospace, "SF Mono", Menlo, monospace` |
| `--text-terminal` | `fontSize` | 11 CSS px |
| `--line-terminal` | `lineHeight` | 1.5, unitless |
| `--letter-terminal` | `letterSpacing` | 0.95 CSS px |

Solo's `terminalFontScale` 0.846 multiplies its 13 px base, giving 11 px;
its 1.23 interface scale does not apply to Terminal text. The real rendered
cell measurements, grid counts, loaded faces, local resources and device pixel
ratio are retained in each capture's `*.metrics.json`, beside the PNG and
Check readings under `artifacts/ux/U4456{a,b,c,d}/{base,head}/`.

The Linux observer uses the App's normal WebGL renderer at 1512×950 and
pixel ratio 1. The explicit `customGlyphs: true` option makes xterm draw
box-drawing characters across the full cell instead of using the shorter font
glyph. The capture records the renderer alongside each measurement; behavioral
font/input/resize regressions still exercise the DOM fallback. xterm documents
that [custom glyphs do not apply to DOM rendering](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/#customglyphs).

The critic's requested correction uses lineHeight 1.5 at 11 CSS px to retain
U3517b's 18–20 CSS px row pitch. xterm multiplies the measured font bounding
height rather than CSS fontSize: 1.7 yielded 22 CSS px rows, while 1.5 yields
19 CSS px rows. Letter spacing remains 0.95 CSS px. This calibration supersedes
the earlier 1.7 setting; it does not lower the pitch or continuous-frame bar.
The original Solo screenshot is still unavailable, so no sampled-image match
is claimed.

The corrected paired capture uses base `adbf2eb65` and the renderer repair
`a01194dc0` with the isolated default-preference capture fixture, Chromium on
Linux, dark mode, 1512×950 and DPR 1:

| Surface | Main cell width × height | Head cell width × height | Main grid → head grid |
| --- | --- | --- | --- |
| Agent | 8.4 × 19 CSS px | 7 × 19 CSS px | 105×42 → 126×42 |
| Door | 8.4 × 19 CSS px | 7 × 19 CSS px | 105×42 → 126×42 |
| Shell Bubble | 8.398 × 19 CSS px | 7 × 19 CSS px | 83×33 → 100×33 |

All three head readings record `renderer: webgl`; main records `dom` after
snapshot restoration. Each table's verticals and junctions join across rows
without the earlier gaps. The renderer is disposed before a snapshot resize
and recreated afterward, retaining the resize safeguard while restoring full-cell
glyphs. A refused WebGL context still selects DOM and logs its warning.
All reported design Checks pass on all six captures, including D2, D5 and D6;
the dense `tree-40` Door and shell show the injected failure text. Images,
Check readings and metrics are under `artifacts/ux/U4456{a,b,c,d}/{base,head}/`.
No image is committed.

`DEFAULT_FONT_SIZE` reads the same size Token for the emulator, App Settings
and Project zoom reset. Saved absolute sizes stay unchanged; clearing a custom
family restores Fira Code. Font readiness, settings and zoom retain the existing
input, scrollback and authoritative resize paths.

## Colours and Checks

Dark uses neutral near-black `#1a1b1d`, soft off-white `#d4d4d4`, cursor and
selection foreground/background inversion, and dim grey `#666666` for ANSI
bright-black table borders. xterm's dim attribute softens ordinary foreground
text. Default text contrast is approximately 11.6:1. The Ghostty dark reference
is retired. The other ANSI slots retain the Tomorrow-family colours; Light
retains the [pinned Tomorrow theme](https://github.com/mbadolato/iTerm2-Color-Schemes/blob/74e6e762b83c9ede7bb5ec9dce855cc8aed54f3b/ghostty/Tomorrow).
Every emulator colour remains a Terminal Token, shared by the viewport, canvas,
empty panes, Bubble and X17's Daemon colour-query replies.

The work order supplies an approximate background and qualitative text/border
reference. Neither #4456 nor #4480 includes the owner's original Solo image,
so these choices are not claimed as sampled Solo pixels. The Linux captures
record the chosen colours for independent critic inspection. Native comparison
remains the owner's observation after merge, never a per-PR Mac gate.

Moves D2, D5 and D6. The rendered fixture shows an Agent, Door and shell Bubble,
a table, normal/dim/bold/italic text, ANSI swatches, selected text, cursor,
wrapped output, an unterminated line and visible injected failure feedback.
Reference ANSI and program-authored cells retain U3517c's contrast exemption;
default text and App controls retain D5.

## Regression observers

- `u3517a_font_readiness_preserves_output_and_fits_once_ready` retains ordered
  output and forbids resize before fonts load.
- `u3517a_font_loading_keeps_live_terminal_input_available` retains one intended
  keystroke while loading, with no additional write when loading completes.
- `u3517b_loaded_metrics_drive_terminal_resize` checks the Daemon resize contract.
- `u3517d_settings_and_project_zoom_share_the_default` retains settings/zoom.
- `u3517d_rendering_changes_keep_input_and_scrollback` retains exact output and
  unterminated text, with zero writes from rendering changes (P11).
- `u3517c_scheme_changes_reach_open_new_and_unattached_terminals` checks all
  scheme consumers; X17's query-ownership and connection-lifetime tests remain.

Rule 10 retirement: X17's copied Ghostty colour expectations now read Terminal
Tokens while retaining its scheme-change assertions. The capture's font-face count and loaded-style assertions are removed: these
are policy observations, retained in the face readings and font-readiness
observers rather than UI appearance assertions. Their exact lint-baseline
entries are removed too. No geometry or
copied-palette test is added. The four obsolete JetBrains font files are removed;
their notice stays. Performance budgets and CI observers are unchanged.

The mock-only `u103_a_snapshot_resize_of_an_open_webgl_emulator_falls_back_to_the_dom_renderer`
is retired: it proved only a mock disposal count. The 25 U103 snapshot tests in
`u103_snapshot.test.tsx` still prove restoration, ordering, recovery and input
preservation. The U4456 rendered observer records the actual renderer and frame.
Capture cases clear prior preferences before opening each surface, and hold
write/resize refusals so an unrelated successful refit cannot erase the intended
failure feedback before the reading.

## Fractional tracking upstream contribution (U4592, #4635)

Status: **unmerged source candidate; painted acceptance fails**. #4635 stays
open for renderer repair, upstream review and merge. #4633 separately owns a
maintained published dependency and its complete published-capability acceptance.
This record changes no roundup runtime, package, Token or acceptance.

Upstream base: [`0ddc8a8fa1c4287297b708722ae2dae83a4ada51`](https://github.com/xtermjs/xterm.js/commit/0ddc8a8fa1c4287297b708722ae2dae83a4ada51).
Local candidate commit: `2f4a1a3f52af19a5c5c3c21355cc09ae2e8268e2` (not pushed;
recoverable from the source patch and test below). No upstream PR, upstream
reviewed commit or merge is claimed. Follow
[xterm's contribution guide](https://github.com/xtermjs/xterm.js/blob/0ddc8a8fa1c4287297b708722ae2dae83a4ada51/CONTRIBUTING.md)
when the candidate satisfies its renderer observers.

### Contribution path and source findings

On 2026-10-28 the shell installation reports upstream `push: false`. The
connected GitHub account, `saadshahd`, also reports upstream `push: false`;
its complete owner-repository listing contains no xterm fork. The connected
write tools provide branches, files and PRs, but no fork/repository creation.
No unrelated repository was used to stage a contribution. The copyable patch
below preserves the work until a fork contribution path is available.

The installed options and platform were inspected first: public `letterSpacing`
is rounded in both upstream renderers; `TextureAtlas` draws joined strings with
native canvas advances against cell-sized allocation. The candidate retains
each renderer's character-width policy, removes tracking quantization, preserves
exact fractional CSS widths for fit/pointer consumers, rounds atlas allocation
up and scales fractional joined runs to their grid span. Integer options retain
the original advance and CSS-canvas rounding; their joined-run path is unchanged.
No renderer replacement, dependency patch or private roundup mutation is added.

This does **not** resolve the maintainer's
[blur/moiré and DOM element-pressure concerns (#6015)](https://github.com/xtermjs/xterm.js/issues/6015)
or complete the
[joined-run clipping/drift repair (#6153)](https://github.com/xtermjs/xterm.js/issues/6153).
The WebGL capture at 0.5 still has periodic gaps along the table's horizontal
edges; the DOM fallback also lacks full-cell custom box glyphs at 22px rows.
The candidate is a starting point for upstream renderer review, not an
upstream-supported capability. No performance or sharpness acceptance is claimed.

### Observed results

Host: `runnervm48cm3`, Ubuntu 24.04.5 LTS, Linux `7.0.0-1017-azure`, x86_64;
Playwright 1.60.0 / Chromium `148.0.7778.96`,
isolated headless context, viewport 1512×950, Dark, DPR 1, no transforms or zoom.
The actual installed Playwright version is recorded by `npm ls @playwright/test`.
WebGL uses SwiftShader (`--enable-unsafe-swiftshader`). Each run uses identical
replay bytes, regular Fira Code 6.2 at 11 CSS px and `lineHeight: 1.7`.
The requested bold 700 is synthesized from the loaded 400 face here; this is
not the complete App weight observer. A direct canvas `W` advance is 7px on
this host, with font readiness true. These source-checkout observations do not
replace #4634's published-package measurements on its different browser host.

| Renderer | Requested spacing | Original advance | Candidate advance | Row pitch | Fitted columns |
|---|---:|---:|---:|---:|---:|
| WebGL | 0.5 | 8 | 7.5 | 22 | 88 |
| WebGL | 0.95 | 8 | 7.95 | 22 | 83 |
| WebGL | 1 | 8 | 8 | 22 | 82 |
| DOM | 0.5 | 8 | 7.5 | 22 | 88 |
| DOM | 0.95 | 8 | 7.95 | 22 | 83 |
| DOM | 1 | 8 | 8 | 22 | 82 |

All dimensions above are CSS px at DPR 1. The host starts at 800×440 CSS px,
then fits at 675×440; scale and replay remain unchanged. All six candidate cases
retain `abcdefghijklmnopqrstuvwx` through public selection, receive exact
keyboard input `draft`, and keep `later output` after fit. WebGL context loss
uses the real `WEBGL_lose_context` extension: the normal delayed notification
fires, addon disposal selects DOM, and `fallback output` remains readable.
DOM uses 30 spans for this short replay at all three spacings; this is no
large-output performance measurement. Pointer drag selection, DPRs other than 1,
WebKit/Firefox, joined-run pixel assertions and broader renderer performance
remain unproved. Public selection proves selected text, not hit-testing.

Font SHA-256:
`a6ce59520b90e15d7062ffef214f94c8add5a4085c0bbb1683602ef227a4d1fe`.
Replay UTF-8 SHA-256:
`fe5e5ef161e2b5e52c589f94c884f18c61fdbf3b0082ee5a09d2605a805ea48a`.
Source patch SHA-256:
`b3fe1320317dd5c909328a078341af883b05b7d1aa1a6a03faa89d79e89d7556`.

Local PNGs and metric JSON are retained, uncommitted, under
`artifacts/ux/U4592/upstream-source/{base,head}/`. They are isolated source
observations, not paired App acceptance or a design-critic approval.

### Commands and exits

Run in the pinned upstream checkout. Save the TypeScript block to
`test/playwright/LetterSpacing.test.ts`, the diff block to `/tmp/fractional.patch`
and the JavaScript block to `fractional-repro.mjs`. Use the bundled font path
from a roundup checkout as `FIRA_CODE`. No package is patched in roundup.

```sh
git clone https://github.com/xtermjs/xterm.js.git xterm-fractional
cd xterm-fractional
git checkout 0ddc8a8fa1c4287297b708722ae2dae83a4ada51
npm ci --ignore-scripts
npx playwright install chromium
npm run build
npm run esbuild
npm run esbuild-demo-client
npm run esbuild-demo-server
npx playwright test -c out-esbuild-test/playwright/playwright.config.js LetterSpacing --project=Chromium --workers=1
git apply --check /tmp/fractional.patch
git apply /tmp/fractional.patch
npm run build
npm run esbuild
npm run esbuild-demo-client
npx playwright test -c out-esbuild-test/playwright/playwright.config.js LetterSpacing --project=Chromium --workers=1
npm run lint-changes
npm run lint-api
npm run test-unit
FIRA_CODE=/absolute/path/to/roundup/apps/desktop/public/fonts/fira-code/FiraCode-Regular.woff2 node fractional-repro.mjs
```

| Command / observer | Exit and result |
|---|---|
| `npm ci --ignore-scripts`; browser install; build/bundle/demo commands | 0 |
| New renderer test against original source | 1: both renderers return a 1px increment instead of 0.5 |
| Same renderer test with final candidate | 0: 2 passed |
| `npm run lint-changes`; `npm run lint-api` | 0 each |
| `npm run test-unit` | 0: 2460 passed |
| Isolated reproduction, original source | 0: both spacing values round to 8px; rows/input/selection/output and context-loss fallback retained |
| Isolated reproduction, final candidate | 0: six cases above; three context-loss/fallback cases pass |
| Initial test setup | 1: worker-scoped `launchOptions` inside `describe`; moved to file scope |
| Initial TypeScript build | 1: `Window.term` undeclared; replaced callback with the existing string-evaluation convention |
| Intermediate compatibility assertion | 1: exact CSS width incorrectly required for integer options; narrowed to fractional options, retaining original integer canvas rounding |
| Initial context-loss observer | 1: first canvas was a 2D layer; select the actual WebGL canvas by context capability |
| Painted joined-box acceptance | FAIL: periodic WebGL edge gaps and DOM row gaps; no passing exit or critic approval claimed |

### Regression first

The public `Terminal.dimensions` observer distinguishes fractional options and
checks their CSS advance after resize. It also exercises public selection and
actual keyboard input. It does not prove painted joins. No existing test is
removed; the new tracking assertion catches a break not covered by the existing
whole-pixel renderer suite.

<!-- xterm-fractional-test -->
```ts
/**
 * Copyright (c) 2026 The xterm.js authors. All rights reserved.
 * @license MIT
 */
import { expect, test } from '@playwright/test';
import { createTestContext, openTerminal } from './TestUtils';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

for (const renderer of ['dom', 'webgl']) {
  test.describe(`${renderer} fractional letter spacing`, () => {
    test('fractional tracking survives resize, selection and later output', async ({ browser }) => {
      const ctx = await createTestContext(browser);
      try {
        await openTerminal(ctx, { cols: 80, rows: 10, fontSize: 11, letterSpacing: 0 });
        if (renderer === 'webgl') {
          await ctx.page.evaluate('window.addon = new window.WebglAddon(true); window.term.loadAddon(window.addon)');
        }
        const base = (await ctx.proxy.dimensions)!.device.cell.width;
        for (const spacing of [0.5, 0.95, 1, 0]) {
          await ctx.page.evaluate(`window.term.options.letterSpacing = ${spacing}`);
          await expect.poll(async () => (await ctx.proxy.dimensions)!.device.cell.width).toBeCloseTo(base + spacing, 6);
          await ctx.proxy.write('\r\n-> => != === later output');
          await ctx.proxy.resize(67, 12);
          if (!Number.isInteger(spacing)) {
            expect((await ctx.proxy.dimensions)!.css.cell.width).toBeCloseTo(base + spacing, 6);
          }
          await ctx.proxy.select(0, spacing === 0.5 ? 1 : spacing === 0.95 ? 2 : spacing === 1 ? 3 : 4, 2);
          expect(await ctx.proxy.getSelection()).toBe('->');
        }
        await ctx.page.evaluate('window.input = []; window.term.onData(data => window.input.push(data)); window.term.focus()');
        await ctx.page.keyboard.type('draft');
        expect(await ctx.page.evaluate('window.input.join("")')).toBe('draft');
      } finally {
        await ctx.page.close();
      }
    });
  });
}
```

### Source patch

<!-- xterm-fractional-source-patch -->
```diff
diff --git a/addons/addon-webgl/src/TextureAtlas.ts b/addons/addon-webgl/src/TextureAtlas.ts
index 4977ad7..56420d5 100644
--- a/addons/addon-webgl/src/TextureAtlas.ts
+++ b/addons/addon-webgl/src/TextureAtlas.ts
@@ -482,7 +482,7 @@ export class TextureAtlas implements ITextureAtlas {
     // Allow 1 cell width per character, with a minimum of 2 (CJK), plus some padding. This is used
     // to draw the glyph to the canvas as well as to restrict the bounding box search to ensure
     // giant ligatures (eg. =====>) don't impact overall performance.
-    const allowedWidth = Math.min(this._config.deviceCellWidth * Math.max(chars.length, 2) + TMP_CANVAS_GLYPH_PADDING * 2, this._config.deviceMaxTextureSize);
+    const allowedWidth = Math.min(Math.ceil(this._config.deviceCellWidth * Math.max(chars.length, 2) + TMP_CANVAS_GLYPH_PADDING * 2), this._config.deviceMaxTextureSize);
     if (this._tmpCanvas.width < allowedWidth) {
       this._tmpCanvas.width = allowedWidth;
     }
@@ -737,7 +737,19 @@ export class TextureAtlas implements ITextureAtlas {

     // Draw the character
     if (!customGlyph) {
+      // Joined runs must end at the same cell boundary as the next glyph. Native
+      // font advances can differ from the tracked grid and clip the atlas canvas.
+      this._tmpCtx.save();
+      if (!Number.isInteger(this._config.letterSpacing) && chWidth > 1) {
+        const measuredWidth = this._tmpCtx.measureText(chars).width;
+        if (measuredWidth > 0) {
+          this._tmpCtx.translate(padding, 0);
+          this._tmpCtx.scale(this._config.deviceCellWidth * chWidth / measuredWidth, 1);
+          this._tmpCtx.translate(-padding, 0);
+        }
+      }
       this._tmpCtx.fillText(chars, padding, padding + this._config.deviceCharHeight);
+      this._tmpCtx.restore();
     }

     // If this character is underscore and beyond the cell bounds, shift it up until it is visible
diff --git a/addons/addon-webgl/src/WebglRenderer.ts b/addons/addon-webgl/src/WebglRenderer.ts
index a951efb..12d0ce0 100644
--- a/addons/addon-webgl/src/WebglRenderer.ts
+++ b/addons/addon-webgl/src/WebglRenderer.ts
@@ -668,7 +668,7 @@ export class WebglRenderer extends Disposable implements IRenderer {
     this.dimensions.device.char.top = this._optionsService.rawOptions.lineHeight === 1 ? 0 : Math.round((this.dimensions.device.cell.height - this.dimensions.device.char.height) / 2);

     // Calculate the device cell width, taking the letterSpacing into account.
-    this.dimensions.device.cell.width = this.dimensions.device.char.width + Math.round(this._optionsService.rawOptions.letterSpacing);
+    this.dimensions.device.cell.width = this.dimensions.device.char.width + this._optionsService.rawOptions.letterSpacing;

     // Calculate the x offset with a cell that text should draw from in order for it to be centered
     // correctly within the cell.
@@ -685,7 +685,10 @@ export class WebglRenderer extends Disposable implements IRenderer {
     // it's actually 1.1. Ceiling may cause blurriness as the backing canvas image is 1 pixel too
     // large for the canvas element size.
     this.dimensions.css.canvas.height = Math.round(this.dimensions.device.canvas.height / this._devicePixelRatio);
-    this.dimensions.css.canvas.width = Math.round(this.dimensions.device.canvas.width / this._devicePixelRatio);
+    // Preserve the existing canvas rounding for whole-pixel consumers. Fractional
+    // tracking needs the exact CSS width so fitting and pointer coordinates agree.
+    const cssCanvasWidth = this.dimensions.device.canvas.width / this._devicePixelRatio;
+    this.dimensions.css.canvas.width = Number.isInteger(this._optionsService.rawOptions.letterSpacing) ? Math.round(cssCanvasWidth) : cssCanvasWidth;

     // Get the CSS dimensions of an individual cell. This needs to be derived from the calculated
     // device pixel canvas value above. CharMeasure.width/height by itself is insufficient when the
diff --git a/src/browser/renderer/dom/DomRenderer.ts b/src/browser/renderer/dom/DomRenderer.ts
index 657217f..81daed8 100644
--- a/src/browser/renderer/dom/DomRenderer.ts
+++ b/src/browser/renderer/dom/DomRenderer.ts
@@ -137,13 +137,16 @@ export class DomRenderer extends Disposable implements IRenderer {
     const dpr = this._coreBrowserService.dpr;
     this.dimensions.device.char.width = this._charSizeService.width * dpr;
     this.dimensions.device.char.height = Math.ceil(this._charSizeService.height * dpr);
-    this.dimensions.device.cell.width = this.dimensions.device.char.width + Math.round(this._optionsService.rawOptions.letterSpacing);
+    this.dimensions.device.cell.width = this.dimensions.device.char.width + this._optionsService.rawOptions.letterSpacing;
     this.dimensions.device.cell.height = Math.floor(this.dimensions.device.char.height * this._optionsService.rawOptions.lineHeight);
     this.dimensions.device.char.left = 0;
     this.dimensions.device.char.top = 0;
     this.dimensions.device.canvas.width = this.dimensions.device.cell.width * this._bufferService.cols;
     this.dimensions.device.canvas.height = this.dimensions.device.cell.height * this._bufferService.rows;
-    this.dimensions.css.canvas.width = Math.round(this.dimensions.device.canvas.width / dpr);
+    // Preserve the existing canvas rounding for whole-pixel consumers. Fractional
+    // tracking needs the exact CSS width so fitting and pointer coordinates agree.
+    const cssCanvasWidth = this.dimensions.device.canvas.width / dpr;
+    this.dimensions.css.canvas.width = Number.isInteger(this._optionsService.rawOptions.letterSpacing) ? Math.round(cssCanvasWidth) : cssCanvasWidth;
     this.dimensions.css.canvas.height = Math.round(this.dimensions.device.canvas.height / dpr);
     this.dimensions.css.cell.width = this.dimensions.css.canvas.width / this._bufferService.cols;
     this.dimensions.css.cell.height = this.dimensions.css.canvas.height / this._bufferService.rows;
diff --git a/typings/xterm-headless.d.ts b/typings/xterm-headless.d.ts
index 21e884e..f7812ae 100644
--- a/typings/xterm-headless.d.ts
+++ b/typings/xterm-headless.d.ts
@@ -83,7 +83,10 @@ declare module '@xterm/headless' {
     drawBoldTextInBrightColors?: boolean;

     /**
-     * The spacing in whole pixels between characters.
+     * The spacing in device pixels between characters, including fractional
+     * values. Fractional spacing may affect glyph sharpness depending on the
+     * renderer and device pixel ratio. Whole-pixel values retain their existing
+     * cell advances.
      */
     letterSpacing?: number;

diff --git a/typings/xterm.d.ts b/typings/xterm.d.ts
index c66a52e..be1e2db 100644
--- a/typings/xterm.d.ts
+++ b/typings/xterm.d.ts
@@ -140,7 +140,10 @@ declare module '@xterm/xterm' {
     ignoreBracketedPasteMode?: boolean;

     /**
-     * The spacing in whole pixels between characters.
+     * The spacing in device pixels between characters, including fractional
+     * values. Fractional spacing may affect glyph sharpness depending on the
+     * renderer and device pixel ratio. Whole-pixel values retain their existing
+     * cell advances.
      */
     letterSpacing?: number;

```

### Isolated public-interface reproduction

This server binds only to loopback, serves a fixed allowlist, creates a fresh
headless context and closes its browser/server. It imports the source build's
public modules; no xterm private renderer fields are read or written. Screenshots
are observations; the script asserts continuity and metrics prerequisites only.

<!-- xterm-fractional-reproduction -->
```js
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const font = readFileSync(process.env.FIRA_CODE);
const replay = '┌──────────────────────────────────────┐\r\n│ Example answer                       │\r\n├──────────────────────────────────────┤\r\n│ -> => != ===                         │\r\n└──────────────────────────────────────┘\r\nregular \x1b[1mbold\x1b[0m \x1b[2mdim\x1b[0m \x1b[3mitalic\x1b[0m\r\nabcdefghijklmnopqrstuvwx -> => != ===\r\n';
const hash = x => createHash('sha256').update(x).digest('hex');
const server = createServer((req, res) => {
  if (req.url === '/') { res.end('<div id="terminal" style="width:800px;height:440px"></div>'); return; }
  const paths = {'/xterm.mjs':'lib/xterm.mjs','/webgl.mjs':'addons/addon-webgl/lib/addon-webgl.mjs','/fit.mjs':'addons/addon-fit/lib/addon-fit.mjs','/xterm.css':'css/xterm.css'};
  res.setHeader('Content-Type', req.url.endsWith('.mjs') ? 'text/javascript' : req.url.endsWith('.css') ? 'text/css' : 'font/woff2');
  if (req.url === '/font.woff2') res.end(font);
  else if (paths[req.url]) res.end(readFileSync(paths[req.url]));
  else { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try {
  const context = await browser.newContext({viewport:{width:1512,height:950},deviceScaleFactor:1,colorScheme:'dark'});
  const results = [];
  for (const renderer of ['webgl','dom']) for (const spacing of [0.5,0.95,1]) {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addStyleTag({url:'/xterm.css'});
    await page.addStyleTag({content:'@font-face { font-family: "Fira Code"; src: url(/font.woff2); font-weight: 400; }'});
    const reading = await page.evaluate(async ({renderer,spacing,replay}) => {
      const [{Terminal},{WebglAddon},{FitAddon}] = await Promise.all([import('/xterm.mjs'),import('/webgl.mjs'),import('/fit.mjs')]);
      await document.fonts.load('11px "Fira Code"');
      await document.fonts.ready;
      const term = new Terminal({allowProposedApi:true,fontFamily:'Fira Code',fontSize:11,lineHeight:1.7,letterSpacing:spacing,customGlyphs:true,cols:80,rows:20});
      term.open(document.querySelector('#terminal'));
      const fit = new FitAddon(); term.loadAddon(fit);
      let addon;
      if (renderer === 'webgl') { addon = new WebglAddon(true); term.loadAddon(addon); }
      term.registerCharacterJoiner(text => [...text.matchAll(/abcdefghijklmnopqrstuvwx|->|=>|!=|===/g)].map(m => [m.index,m.index+m[0].length]));
      const write = text => new Promise(r => term.write(text,r));
      const paint = () => new Promise(r => { const d = term.onRender(() => {d.dispose(); r();}); term.refresh(0,term.rows-1); });
      await write(replay); await paint();
      const fontReady = document.fonts.check('11px "Fira Code"');
      const measureCanvas = document.createElement('canvas').getContext('2d');
      measureCanvas.font = '11px "Fira Code"';
      const fontAdvance = measureCanvas.measureText('W').width;
      const before = structuredClone(term.dimensions);
      term.select(0,6,24); const selected = term.getSelection();
      const input = []; term.onData(data=>input.push(data)); term.focus();
      window.term = term; window.input = input; window.addon = addon;
      document.querySelector('#terminal').style.width = '675px'; fit.fit();
      await write('later output\r\n'); await paint();
      const after = structuredClone(term.dimensions);
      const rows = Array.from({length:term.buffer.active.length},(_,i)=>term.buffer.active.getLine(i).translateToString(true));
      return {renderer,spacing,fontReady,fontAdvance,dpr:devicePixelRatio,before,after,cols:term.cols,rows:term.rows,selected,later:rows.includes('later output'),spans:document.querySelectorAll('.xterm-rows span').length};
    },{renderer,spacing,replay});
    await page.keyboard.type('draft');
    reading.input = await page.evaluate('window.input.join("")');
    mkdirSync('/tmp/xterm-4635-captures',{recursive:true});
    await page.screenshot({path:`/tmp/xterm-4635-captures/${renderer}-${spacing}.png`});
    if (renderer === 'webgl') {
      reading.contextLossFallback = await page.evaluate(async () => {
        const term = window.term;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('context loss notification missing')), 8000);
          window.addon.onContextLoss(() => { clearTimeout(timer); window.addon.dispose(); resolve(); });
          const gl = Array.from(term.element.querySelectorAll('.xterm-screen canvas')).map(c => c.getContext('webgl2')).find(Boolean);
          const extension = gl.getExtension('WEBGL_lose_context');
          if (!extension) { clearTimeout(timer); reject(new Error('WEBGL_lose_context missing')); return; }
          extension.loseContext();
        });
        await new Promise(r => term.write('fallback output\r\n', r));
        return Array.from({length:term.buffer.active.length},(_,i)=>term.buffer.active.getLine(i).translateToString(true)).includes('fallback output');
      });
    }
    results.push(reading); await page.close();
  }
  const report = {browser:browser.version(),host:process.platform,viewport:[1512,950],fontSha256:hash(font),replaySha256:hash(replay),results};
  writeFileSync('/tmp/xterm-4635-report.json', JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(results.some(r=>r.before.css.cell.height!==22 || !r.later || r.input!=='draft' || r.selected!=='abcdefghijklmnopqrstuvwx' || (r.renderer==='webgl' && !r.contextLossFallback))) process.exitCode=1;
} finally { await browser.close(); server.close(); }
```
