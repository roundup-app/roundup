# Terminal typography (U4592)

Terminal output uses Fira Code 6.2, replacing the JetBrains Mono font files.
The unmodified Light (300), regular (400) and bold (700) WOFF2 files, OFL notice, upstream
release URL and SHA-256 hashes are in
`apps/desktop/public/fonts/fira-code/`. The original JetBrains Mono licence
notice remains alongside it. Fira Code supplies no italic files: browser font
synthesis renders italic and bold italic from the bundled faces. The emulator
requests normal and italic at all three bundled weights before its first authoritative fit.
Local App URLs have no `local()` or remote font source; other App typography
keeps its existing stack. `--weight-terminal` selects 300 through xterm’s public `fontWeight`; bold remains 700.

## Metrics

| Token | xterm option | Value |
| --- | --- | --- |
| `--font-terminal` | `fontFamily` | `"Fira Code", ui-monospace, "SF Mono", Menlo, monospace` |
| `--text-terminal` | `fontSize` | 11 CSS px |
| `--line-terminal` | `lineHeight` | 1.7, unitless |
| `--letter-terminal` | `letterSpacing` | 0.5 CSS px |
| `--weight-terminal` | `fontWeight` | 300 (bold 700) |

Solo's `terminalFontScale` 0.846 multiplies its 13 px base, giving 11 px;
its 1.23 interface scale does not apply to Terminal text. The real rendered
cell measurements, grid counts, loaded faces, local resources and device pixel
ratio are retained in each capture's `*.metrics.json`, beside the PNG and
Check readings under `artifacts/ux/U4592/{base,head}/`.

The Linux observer uses the App's normal WebGL renderer at 1512×950 and
pixel ratio 1. The explicit `customGlyphs: true` option makes xterm draw
box-drawing characters across the full cell instead of using the shorter font
glyph. The capture records the renderer alongside each measurement; behavioral
font/input/resize regressions still exercise the DOM fallback. xterm documents
that [custom glyphs do not apply to DOM rendering](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/#customglyphs).

U4592 deliberately departs from Solo's weight and tracking. Its controlled Linux
comparison held 11 CSS px, 400/700, tracking 0.95px, DPR 1 and the replay constant:
WebGL joined boxes; DOM left visible gaps; host antialiased smoothing left the
regular-text crop pixel-identical; the upstream Light face produced thinner
strokes with unchanged bold. Candidate images and metadata live under
`artifacts/ux/U4592/candidates/`. This is a Builder observation; the independent
critic judges the paired main/head images. It establishes no WebKit rendering fact.

The selected WebGL path uses the bundled Light face. The official ligature
addon candidate visibly joined operators, but failed four existing scale guards
that pass on main; it is rejected from this slice. The shared renderer stays
unchanged apart from public font-weight and metric options. Joined ligatures
remain part of the incomplete U4592 acceptance.
No custom glyph or shader code is added. xterm’s public weight reaches the atlas
2D context’s font; host smoothing cannot inherit into its detached canvas.
See [TextureAtlas](https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-webgl/src/TextureAtlas.ts)
and [ligature support](https://github.com/xtermjs/xterm.js/blob/6.0.0/addons/addon-ligatures/README.md).
WebGL refusal and context loss retain DOM fallback and its existing guarantees.

The 1.7 multiplier restores the required 22 CSS px rows at 11px; xterm measures
font bounding height, so multiplying CSS font size alone would give the wrong pitch.
Paired observations use the same replay bytes and Dark 1512×950 viewport in
`artifacts/ux/U4592/{base,head}/`; metadata records commits, font readiness,
requested weights, display/canvas scale, rectangles, grid counts and stream hash.
Native appearance and K1–K3 timing remain the owner’s post-merge observations.

The tracking Token is 0.5px, but installed xterm 6 rounds `letterSpacing` with
`Math.round` in both renderers. Both 0.95 and 0.5 therefore add one device pixel:
paired DPR-1 captures retain 7px cells and 126 columns in the Agent/Door.
Reduced horizontal tracking is **not demonstrated**. U4592 and #4619 remain
incomplete until a supported rendering path supplies that change without a
private renderer patch or changing the requested Token, font, size or scale.

## Historical U4456 correction

The following records U4456's earlier 19px calibration, superseded by U4592.

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
