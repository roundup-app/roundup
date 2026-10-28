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
the dense `tree-40` Door and shell show the injected failure text. PNGs,
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
