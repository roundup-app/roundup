# Terminal typography (U3517)

The Terminal uses JetBrains Mono v2.304 regular, bold, italic and bold italic from
`apps/desktop/public/fonts/jetbrains-mono/`. Its README pins upstream and SHA-256s;
OFL.txt ships beside the four unmodified WOFF2 files. The production web build
copies all four files and the notice into `dist/fonts/jetbrains-mono/`. This Linux
host has no installed JetBrains Mono face (`fc-list`); all four browser FontFaces
report loaded. The font-face rules use local App URLs, with no `local()` or remote
font source. Other App typography retains its existing stack.

## Calibration

Start: Ghostty's documented macOS 13 pt default, JetBrains Mono, unadjusted cell
metrics. Native points do not establish xterm CSS pixels. On the isolated Linux
Chromium DOM observer at 1512×950, 14 CSS px with lineHeight 1 measured an 18 px
cell. Raising lineHeight to 1.06 measured the 19 px target. Letter spacing remains
0 CSS px. The DOM grid's measured cell width is about 8.404 CSS px (integer screen
width divided by columns); device pixel ratio is 1. This is web calibration, not
a native Soloterm row/column match.

| Source | xterm option | Chosen value |
| --- | --- | --- |
| `--text-terminal` | `fontSize` | 14 CSS px |
| `--line-terminal` | `lineHeight` | 1.06, unitless |
| `--letter-terminal` | `letterSpacing` | 0 CSS px |

`DEFAULT_FONT_SIZE` reads `--text-terminal`; App Settings and Project zoom reset
already consume that holder. Existing saved Project sizes, including 13 px,
remain absolute sizes. U102's former fixed 13 px reset is retired by U3517d;
the same chord, bounds, focus, resize, persistence and scrollback tests remain.
Font-change tests now move relative to the default so they still exercise a
change after the upgrade.

## Colours and Checks

Dark uses the [pinned Ghostty Config](https://github.com/ghostty-org/ghostty/blob/22f100c6367045bb5fc86172f837047dee2f7670/src/config/Config.zig)
and [Name.default](https://github.com/ghostty-org/ghostty/blob/22f100c6367045bb5fc86172f837047dee2f7670/src/terminal/color.zig)
values: #282c34 background, #ffffff foreground, inverse selection, foreground
cursor with background cursor text, and its sixteen ANSI slots. Light uses
[pinned Tomorrow](https://github.com/mbadolato/iTerm2-Color-Schemes/blob/74e6e762b83c9ede7bb5ec9dce855cc8aed54f3b/ghostty/Tomorrow),
including cursor and selection. `tokens.css` owns every value. The viewport,
canvas and X17 Daemon scheme replies consume those columns, including explicit
Light/Dark on the opposite host scheme. Production CSS may shorten hex and
unquote selectors; the Token reader handles both and keeps X17's six-digit hex
contract.

Moves D2, D5 and D6. Paired main/head captures and Check readings under
`artifacts/ux/U3517{b,c,f}/{base,head}/` show an Agent, a Door and a shell Bubble,
wrapped output, an unterminated line, four styles, selection, ANSI swatches and a
visible injected failure. The first calibration captures exposed the wrong Dark
Token column; those obsolete captures are discarded. Reference ANSI colours
retain U3517c's contrast exception; App controls do not gain one.

P11 gate: can rendering changes lose, alter or deliver unfinished input? The
real-emulator observers retain output and unterminated text, and no
`terminal.write` occurs from readiness, font or size changes. Font readiness
precedes fitting and the authoritative Daemon resize; live output is parsed in
order while the faces load. Existing input, scrollback and snapshot holders are
reused.

## Remaining native acceptance

U3517e requires the existing opt-in Mac keystroke observer, with the bundled face
loaded and unchanged limits. U3517f requires Soloterm and roundup on the same
Mac, same Claude version/folder/window width/scheme/scale, default preferences
and no Project zoom. Record App versions, commit, actual content rectangles,
window dimensions, scale, font settings, row/column counts and captures. Counts
must differ by at most one; the critic judges glyphs, spacing, colours, cursor,
selection and ANSI samples. Inspect Tomorrow in Light without committing images.
No native timing or Soloterm effective configuration is inferred from Linux or
terminfo. #3517 stays open until these observations and the required gates hold.
