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

## Fractional tracking dependency (U4592, #4633)

No published capability is selected. The following is a failing dependency
reproduction, not U4592 completion. #4633 stays open until a maintained published
release/addon preserves fractional tracking through its public API and passes
its renderer regressions. App integration, joined-operator integration, matched
App captures and performance remain on #4627/#4619.

Registry metadata and the exact published tarballs were inspected on 2026-10-28:

| Package | Stable (2025-12-22) | Beta (2026-10-28) |
| --- | --- | --- |
| `@xterm/xterm` | [6.0.0](https://registry.npmjs.org/@xterm/xterm/6.0.0) | [6.1.0-beta.317](https://registry.npmjs.org/@xterm/xterm/6.1.0-beta.317) |
| `@xterm/addon-webgl` | [0.19.0](https://registry.npmjs.org/@xterm/addon-webgl/0.19.0) | [0.20.0-beta.311](https://registry.npmjs.org/@xterm/addon-webgl/0.20.0-beta.311) |

Stable source is commit `f447274f430fd22513f6adbf9862d19524471c04`;
beta source is `66d176327e3b4b92cabe73150406fa6ab36ebb37`.
Both [stable WebGL](https://github.com/xtermjs/xterm.js/blob/f447274f430fd22513f6adbf9862d19524471c04/addons/addon-webgl/src/WebglRenderer.ts)
and [beta WebGL](https://github.com/xtermjs/xterm.js/blob/66d176327e3b4b92cabe73150406fa6ab36ebb37/addons/addon-webgl/src/WebglRenderer.ts),
`_updateDimensions`, add `Math.round(letterSpacing)` to the device character
width. [Stable DOM](https://github.com/xtermjs/xterm.js/blob/f447274f430fd22513f6adbf9862d19524471c04/src/browser/renderer/dom/DomRenderer.ts)
and [beta DOM](https://github.com/xtermjs/xterm.js/blob/66d176327e3b4b92cabe73150406fa6ab36ebb37/src/browser/renderer/dom/DomRenderer.ts)
do the same. The [public option](https://github.com/xtermjs/xterm.js/blob/66d176327e3b4b92cabe73150406fa6ab36ebb37/typings/xterm.d.ts)
explicitly specifies whole pixels. Neither pair supplies the requested capability;
changing only the dependency version is insufficient.

### Isolated renderer reproduction

From a roundup checkout, prepare an external scratch directory with the exact
published packages and the bundled unmodified Fira Code 6.2 regular face:

```sh
python3 - <<'PYTHON'
import io, json, pathlib, shutil, tarfile, urllib.request
root = pathlib.Path('/tmp/xterm-spacing-audit')
root.mkdir(exist_ok=True)
for name, version in [('@xterm/xterm', '6.0.0'),
                      ('@xterm/xterm', '6.1.0-beta.317'),
                      ('@xterm/addon-webgl', '0.19.0'),
                      ('@xterm/addon-webgl', '0.20.0-beta.311')]:
    metadata = json.load(urllib.request.urlopen(
        'https://registry.npmjs.org/' + name + '/' + version))
    target = root / (name.replace('/', '-') + '-' + version)
    target.mkdir(exist_ok=True)
    archive = urllib.request.urlopen(metadata['dist']['tarball']).read()
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as package:
        package.extractall(target, filter='data')
shutil.copy('apps/desktop/public/fonts/fira-code/FiraCode-Regular.woff2', root)
PYTHON
```

Save this as `/tmp/xterm-spacing-audit/repro.html`. It reads public options,
the rendered screen rectangle and canvas backing dimensions; it never reads or
mutates private renderer state. Each terminal receives the same UTF-8 bytes.
The two frames follow the write callback to allow the renderer to paint;
this diagnostic is not a continued-paint or visual acceptance test.

```html
<!doctype html>
<meta charset="utf-8">
<style>
@font-face { font-family: "Fira Code"; src: url("FiraCode-Regular.woff2"); }
body { background: #1a1b1d; color: #d4d4d4; }
.host { width: 900px; height: 220px; margin-bottom: 8px; }
</style>
<script>
const beta = new URLSearchParams(location.search).has('beta');
const terminalPath = beta ? '@xterm-xterm-6.1.0-beta.317' : '@xterm-xterm-6.0.0';
const webglPath = beta ? '@xterm-addon-webgl-0.20.0-beta.311' : '@xterm-addon-webgl-0.19.0';
document.write(`<link rel="stylesheet" href="${terminalPath}/package/css/xterm.css">`);
document.write(`<script src="${terminalPath}/package/lib/xterm.js"><\/script>`);
document.write(`<script src="${webglPath}/package/lib/addon-webgl.js"><\/script>`);
</script>
<script type="module">
const replay = new TextEncoder().encode('┌────────────────────┐\r\n│ Example answer     │\r\n├────────────────────┤\r\n│ -> => != ===       │\r\n└────────────────────┘\r\nregular \x1b[1mbold\x1b[0m\r\n');
await document.fonts.load('11px "Fira Code"');
await document.fonts.ready;
window.results = [];
for (const mode of ['webgl', 'dom']) for (const letterSpacing of [0.5, 0.95]) {
  const host = document.createElement('div');
  host.className = 'host';
  document.body.append(host);
  const term = new Terminal({ cols: 80, rows: 10, fontFamily: 'Fira Code',
    fontSize: 11, lineHeight: 1.7, letterSpacing, customGlyphs: true });
  term.open(host);
  if (mode === 'webgl') term.loadAddon(new WebglAddon.WebglAddon());
  await new Promise(resolve => term.write(replay, resolve));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const screen = host.querySelector('.xterm-screen').getBoundingClientRect();
  const canvas = host.querySelector('canvas');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', replay))]
    .map(x => x.toString(16).padStart(2, '0')).join('');
  results.push({ beta, mode, letterSpacing, dpr: devicePixelRatio,
    scale: visualViewport.scale, host: host.getBoundingClientRect().toJSON(),
    width: screen.width, height: screen.height, advance: screen.width / term.cols,
    rowPitch: screen.height / term.rows, cols: term.cols, rows: term.rows,
    backingWidth: canvas?.width, backingHeight: canvas?.height,
    replayBytes: replay.length, replaySha256: hash, userAgent: navigator.userAgent });
}
window.done = true;
</script>
```

Serve with `python3 -m http.server 8933 --bind 127.0.0.1 --directory
/tmp/xterm-spacing-audit` (keep it running). In another shell, use a new session
and an unused profile path; never attach to an existing browser:

```sh
browser=apps/desktop/node_modules/.bin/agent-browser
"$browser" --session builder-40734816244-xterm \
  --profile /tmp/builder-40734816244-xterm-profile \
  --executable-path /usr/bin/chromium \
  --args '--use-gl=angle,--use-angle=swiftshader,--enable-unsafe-swiftshader,--force-device-scale-factor=1' \
  open http://127.0.0.1:8933/repro.html
"$browser" --session builder-40734816244-xterm set viewport 1512 950
"$browser" --session builder-40734816244-xterm wait --fn 'window.done === true'
"$browser" --session builder-40734816244-xterm eval 'window.results'
"$browser" --session builder-40734816244-xterm open 'http://127.0.0.1:8933/repro.html?beta'
"$browser" --session builder-40734816244-xterm wait --fn 'window.done === true'
"$browser" --session builder-40734816244-xterm eval 'window.results'
"$browser" --session builder-40734816244-xterm close
```

Observed 2026-10-28 on Linux x86_64, HeadlessChrome/156.0.0.0, software WebGL2
(SwiftShader), 1512×950 viewport, DPR 1, `visualViewport.scale` 1. Hosts are
900×220 CSS px; font is Fira Code regular at 11 CSS px, `lineHeight: 1.7`.
Regular WOFF2 SHA-256:
`a6ce59520b90e15d7062ffef214f94c8add5a4085c0bbb1683602ef227a4d1fe`.
Replay: 282 bytes, SHA-256
`9b98ab4a5973df9f540eff4c8e6ce5cfdcae99dd638b602b742a8b1f930d14f6`.

| Published pair | Renderer | Advance at 0.5 | Advance at 0.95 | Screen / backing | Rows |
| --- | --- | --- | --- | --- | --- |
| Stable | WebGL | 7px | 7px | 560×220 / 560×220 | 10 × 22px |
| Beta | WebGL | 7px | 7px | 560×220 / 560×220 | 10 × 22px |
| Stable | DOM | 7.775px | 7.775px | 622×220 / none | 10 × 22px |
| Beta | DOM | 7.775px | 7.775px | 622×220 / none | 10 × 22px |

Advances are rendered screen width divided by 80 columns; pitch is rendered
height divided by 10 rows. They demonstrate no spacing distinction within
either renderer. Setup, browser open, viewport, both readiness waits, both
measurements and both screenshots exited 0. The distinction required by #4633
fails. No candidate is integrated. This observation does not establish joined
operators/boxes, later painting, fitted resize, selection, input, fallback or
context-loss acceptance, nor App visual/performance or WKWebView results.
Those remain required when an upstream-supported published candidate exists.
