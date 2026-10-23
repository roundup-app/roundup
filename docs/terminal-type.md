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
remain absolute sizes. U3529c's Terminal-only blue-highlight requirement is narrowed by this work order's
explicit Ghostty/Tomorrow selection requirement; App/editor selections keep their
platform Token. U102's former fixed 13 px reset is retired by U3517d;
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


## Validation and blockers

`pnpm install`, production web build, focused emulator/settings/zoom/scheme
observers and Rust lints/proofs pass on the implementation. Final merged-head
web and rendered checks are recorded on #3517. Main's unrelated Combobox
Stylelint failure is owned by open #3601; this change does not weaken that gate.
The broad capture/related attempts were superseded by merging main and repairing
input readiness; they are not reported as passing full-suite runs. CI remains
the judge of every test on the pushed head.

`just perf` exits 1 twice. The retained `artifacts/ux/U3517e/` reports include every
sample, load, host, Rust source tree and binary hashes. The first run has five
explicit timing skips under load, plus Rail-10 absolute and RSS misses. The
lower-load run makes all comparisons and fails these existing ceilings:

| Command | Exit | Failure | Median | Ceiling |
| --- | --- | --- | --- | --- |
| `just perf` (busy) | 1 | Rail-10 absolute p95, ms | 3.257 | 2 |
| `just perf` (busy) | 1 | extra RSS, MB | 2.109 | 1.810 |
| `just perf` (busy) | 1 | cold plugin comparison missing | skipped for load | required |
| `just perf` (busy) | 1 | ping comparison missing | skipped for load | required |
| `just perf` (busy) | 1 | Rail-40 comparison missing | skipped for load | required |
| `just perf` (busy) | 1 | Terminal write comparison missing | skipped for load | required |
| `just perf` (busy) | 1 | write-to-output comparison missing | skipped for load | required |
| `just perf` (lower load) | 1 | cold plugin materialization, ms | 31.869 | 13.136 |
| `just perf` (lower load) | 1 | ping p95, ms | 0.384 | 0.029 |
| `just perf` (lower load) | 1 | Rail-40 p95, ms | 3.862 | 0.293 |
| `just perf` (lower load) | 1 | extra RSS, MB | 2.172 | 1.810 |
| `just perf` (lower load) | 1 | Terminal write p95, ms | 2.644 | 0.062 |
| `just perf` (lower load) | 1 | write-to-output p95, ms | 2.992 | 0.074 |

Cold start, hook-loop cost and the lower-load Rail-10 absolute limit pass. No
baseline, budget, workload or probe is changed by this PR. No Daemon source
changes appear against main; these reports do not measure the bundled font or
establish native keystroke latency.

The existing Linux gate repair #1990 and machine-class observer #1251 were
closed by the owner as not planned. The Builder rule forbids silently restoring
cancelled prerequisites. #3517 therefore needs the user's decision to restore
#1990's scoped existing-gate repair, or explicitly revise that acceptance. The
recommendation is to preserve acceptance and reopen #1990; no cancelled Issue is
added as a blocker. Native U3517e/f observations remain separately required.


The final merged-source focused run passes 55 retained tests. Four isolated rendered/
behavior observers pass without retry: loaded-face resize, rendering-change
scrollback/input retention, the six-state main/head capture, and the existing
hint-line guard that exposed the input-readiness regression. All six captures
have no failing Check; their 19 px head pitch replaces main's 15 px. A separate
held-font live-input guard verifies one intended keystroke is delivered while
font readiness is held, and no second write occurs on release.


The duplicate `u3805_open_terminals_take_the_new_theme` test is cut:
`u3517c_scheme_changes_reach_open_new_and_unattached_terminals` retains its open-
emulator proof and adds future emulators and the unattached Daemon scheme seam.
The other five settings tests remain. Light was inspected in an isolated fresh
browser profile: the viewport is white and foreground, cursor, selection and all
ANSI slots resolve the pinned Tomorrow values. No Light image is retained.
