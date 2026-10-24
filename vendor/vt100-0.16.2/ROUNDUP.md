# Bounded parser state (X14 prerequisite, #2121)

Sources are the crates.io **vt100 0.16.2** and **vte 0.15.0** packages,
not moving Git branches. Root Cargo.toml pins vt100 exactly and patches both
packages to these licensed sources; Cargo.lock pins their transitive dependencies.
Original normalized manifests and Cargo.toml.orig are retained. Original archive
SHA-256 pins (verify with `sha256sum ~/.cargo/registry/cache/*/{vt100-0.16.2,vte-0.15.0}.crate`):

- vt100: `054ff75fb8fa83e609e685106df4faeffdf3a735d3c74ebce97ec557d5d36fd9`
- vte: `a5924018406ce0063cd67f8e008104968b74b563ee1b85dde3ed1f7cb87d3dbd`

 Licences:
vt100 MIT; vte Apache-2.0 OR MIT (both texts included).

The only upstream source changes are:

- vte `Parser::osc_raw` always uses its existing `ArrayVec<u8, OSC_RAW_BUF_SIZE>`
  instead of using an unbounded Vec when `std` is enabled. Its existing capacity
  checks now apply in both configurations. The default cap is **1024 bytes**,
  including the command bytes but excluding semicolon separators. Parameter
  metadata remains capped at 16 entries. Extra payload/separators are ignored
  while remaining in the library's OSC state until termination; the retained
  prefix is dispatched. No discarded suffix becomes printable text. Short titles
  and split sequences keep the upstream behavior. The buffer is inline, so
  termination retains no payload allocation. This remains bounded even if
  another dependency enables `vte/std` through Cargo feature unification.
  The upstream `exceed_max_buffer_size` test expects the cap under std too.
- `Clone` derives on vte `Parser`/`Params` and vt100 `Parser`/`WrappedScreen`.
  A clone includes the library state, partial UTF-8 bytes, pending parameters,
  bounded OSC buffer, screen and callbacks (when callbacks implement Clone).
  Screen/scrollback size is still determined by the caller's configured bounds.
  Cloning a callback with shared external effects does not isolate those effects;
  default `()` callbacks are suitable for read-only text replay.

An Output log can advance a bounded parser through bytes before evicting them,
clone that parser at the cut, and replay the retained suffix into a fresh clone
for each read. No raw evicted prefix or screen serialization is required. This
PR supplies that library capability only; #1930 owns its production adoption.

## Reuse evidence

- [vt100 0.16.2](https://docs.rs/crate/vt100/0.16.2/source/), MIT,
  [release changelog](https://github.com/doy/vt100-rust/blob/fc26fd9c3d72f9af8a214741c100920734500de7/CHANGELOG.md)
  records 2025-07-11; latest upstream commit observed 2025-07-12,
  `fc26fd9c3d72f9af8a214741c100920734500de7`. Selected: preserves the required
  vt100-backed behavior. Unmodified reuse fails: Parser has no Clone, and
  Screen::state_formatted omits pending CSI, OSC and UTF-8 state.
- [vte 0.15.0](https://docs.rs/crate/vte/0.15.0/source/), Apache-2.0 OR MIT,
  [release changelog](https://github.com/alacritty/vte/blob/abeae765dd546dfff60b278f0757dcc71beb8ab1/CHANGELOG.md)
  records its release; latest upstream commit observed 2026-02-28,
  `abeae765dd546dfff60b278f0757dcc71beb8ab1`. Selected existing ArrayVec capacity
  mechanism; unmodified std path has an unbounded OSC Vec and Parser lacks Clone.
  Disabling defaults in roundup cannot undo vt100's additive std selection.
  Upstream master at that commit still has both limitations. A minimal licensed
  source patch reuses its state machine and UTF-8 handling, rather than adding
  another parser. vte alone does not provide vt100's screen emulator.

## Reproduction

From the repository root:

```sh
cargo test -p terminal --test library_parser -- --nocapture
cargo test -p terminal
just check origin/main
```

`x14_library_parser_bounds_pending_osc` runs in an isolated Linux test process,
feeds fixed 8192-byte chunks, samples actual RSS after 1 MiB, 64 MiB and termination,
and asserts at most 1 MiB RSS difference (page/accounting allowance, not a payload
cap). The dispatched title independently asserts exactly 1023 retained title bytes.
It also replays the over-cap pending OSC and tests BEL/ST termination and a later
short title. This is a library retention probe, not a Daemon performance budget.

`x14_library_replay_preserves_pending_state` drops raw prefixes at every byte cut,
replays into three independent clones, compares the full formatted screen with
continuous parsing, checks expected literal contents and confirms the live parser
remains unchanged and can itself finish parsing. Fixtures cover CSI, BEL/ST OSC,
split multibyte UTF-8, redraw/erase and invalid bytes.

The initial unpatched retention probe exited **101**: 4016 KiB at 1 MiB,
68532 KiB at 64 MiB and after termination. The replay probe before Clone derives
exited **101**, E0599. Final command exits and observations are recorded on #2121
and in the PR. No selected-stream, transport, migration, flood, or matched
performance acceptance is claimed.

## Replacement rendering (X14 prerequisite, #2144)

The MIT-licensed vt100 0.16.2 patch also removes U+FFFD from
`WrappedScreen::print`'s unhandled-character filter. Both a literal U+FFFD and
vte's malformed-UTF-8 replacement enter the existing `Screen::text` path,
advance the cursor and invoke the handled-text callback after the screen write.
No decoder, escape recognition or production caller is added. Exact dependency
pins, archive hashes and licences above are unchanged; vte 0.15.0 needs no
additional patch.

The installed-library tests `x14_library_renders_replacement_characters` and
`x14_library_replacement_replay_preserves_cursor_and_offsets` assert literal
screen/cursor/callback results, malformed continuation and truncated sequences
completed by subsequent input, valid split UTF-8, and repeated clones at every
byte cut through UTF-8, CSI and BEL/ST OSC. OSC replacements stay hidden.
A pending incomplete UTF-8 sequence waits for subsequent input; it is not flushed
at an arbitrary chunk boundary. Invalidity becomes observable at the byte that
establishes it, so that byte can complete both a replacement and a following
ASCII write.

C1 controls retain the library's intentional distinction: raw 80–9F bytes are
executed as terminal controls by vte; UTF-8-encoded U+0080–U+009F is reported as
unhandled by vt100. Neither is printable text. This does not discard malformed
text replacements: every U+FFFD emitted by the decoder is rendered, including
when malformed multibyte text is interrupted by a control sequence. The
redraw/erase replay fixture therefore expects `new�!`, replacing `new!`;
all its other assertions remain.

Reuse was rechecked on 2026-10-16 against the upstream repositories linked
above: vt100 main remains `fc26fd9c3d72f9af8a214741c100920734500de7`
(2025-07-12), vte master remains
`abeae765dd546dfff60b278f0757dcc71beb8ab1` (2026-02-28).
Selected: the pinned vt100 screen emulator with this minimal licensed correction.
Unmodified vt100 specifically rejects U+FFFD in `WrappedScreen::print`;
vte alone supplies recognition/decoding but no screen or cursor/erase emulator.
Replacing the screen library cannot preserve the required existing vt100
semantics as directly as removing its erroneous character filter.

The rendering test before the correction exited 101 (`AB` versus `A�B`).
Both new tests and the four existing library prerequisite tests pass after it.
This is library-only evidence, not selected streams, raw Tauri transport,
production parser migration, flood journey or matched performance acceptance.

## Executed controls (X14 prerequisite, #2150)

The additional vt100 source delta is `Callbacks::control` (default no-op) and
one synchronous notification in `WrappedScreen::execute` after applying BS (8),
HT (9), LF (10), VT (11), FF (12) or CR (13). It reports execution even when the
screen and retained history remain identical. Hidden OSC bytes, CSI finals,
text, bells and unhandled controls do not invoke it. No observations or offsets
are retained by the library. Feed one byte per `Parser::process` call and set a
caller-owned completion offset before that call, as for `Callbacks::text`.
Clones retain callback state according to the callback's Clone implementation;
shared external effects still require caller isolation. No vte change is needed.

`x14_library_reports_executed_controls_at_raw_offsets` checks saturated blank
scrollback against a pending OSC clone, literal post-control cursor states and
completion offsets, hidden controls and separation from text/CSI finals.
`x14_library_control_observation_survives_checkpoint_replay` checks literal
controls/text/offsets and repeated read-only replay at every byte cut through
CSI, OSC, UTF-8 and CRLF, including callback and retained-history isolation.
Both use the real installed parser. Existing bounded-state, handled-write and
replacement-rendering observers retain their distinct assertions; none is cut.

Reuse rechecked 2026-10-16: `gh api` for vt100 main and vte master each exited 0
and returned the same revisions/dates recorded above. The pinned upstream
`perform.rs` and vte `lib.rs` were fetched through `gh api` (exit 0). Unmodified
vt100 applies controls without exposing the execution fact; its Screen/Clone
and text callbacks cannot distinguish a ground LF from an OSC LF on saturated
blank history. vte's existing `Perform::execute` supplies that recognition but
vte alone lacks vt100's screen emulator and cannot observe vt100's private
recognizer. Selected: extend the existing vt100 callback boundary, reusing its
installed vte recognizer. Exact dependency pins, archive hashes and licence
texts are unchanged. Actual command exits are recorded on #2150 and its PR.
This supplies no production projection/migration, selected streams, transport,
flood/journey or matched performance evidence; those remain with #1930.

## Portable pending recognition (X14 prerequisite, #2156)

`Parser::pending_formatted()` emits a bounded ANSI prefix. A fresh emulator of
matching dimensions receives the formatted screen, this prefix, then only raw
bytes after the snapshot offset. This supplies a library capability; #1930 still
owns snapshot/offset integration, scrollback projection and exact xterm evidence.
Screen formatting and pending recognition are separate so callers can place
scrollback and screen restoration before entering a pending escape sequence.

The licensed source delta adds vt100's forwarding method, vte's read-only state
exporter and a private Params emitter. No input-path transition or decoder changes.
The exporter uses the recognizer's existing state, saturated numeric parameters,
intermediates, inline OSC buffer/parameter indexes and partial UTF-8 bytes. It
omits controls already executed. OSC separators are reconstructed from indexes;
bytes discarded by the installed OSC cap stay discarded. It emits no cancellation
bytes and stores no raw history. Export does not invoke callbacks or clone them.

Retained attach storage added to Parser: **zero bytes**. Existing pending storage
is inline: 1024 OSC bytes, 16 OSC indexes, 32 numeric parameters, 2 intermediates
and 4 partial UTF-8 bytes plus fixed metadata. The emitted prefix is at most
**1280 bytes** (1024 + 256); OSC specifically is at most **1042 bytes** (1024
payload/command bytes, 16 separators, ESC ]). Size is independent of original
payload length. The installed observer reports a 1688-byte Parser including its
screen/callback holders on Linux x86_64; screen/history and caller callbacks have
separate caller-selected bounds. DCS payload is ignored by vt100 and not retained;
vte's exporter is not a serialization of arbitrary Perform implementations with
external DCS effects. Previously dispatched callbacks are never replayed by an
export on the live parser; restoring a screen/prefix in a new parser can invoke
that new parser's callbacks as usual.

Reuse rechecked 2026-10-16 with `gh api` (both exits 0): vt100 main remains
`fc26fd9c3d72f9af8a214741c100920734500de7` (2025-07-12), vte master remains
`abeae765dd546dfff60b278f0757dcc71beb8ab1` (2026-02-28). Sources, licences,
archive hashes and exact dependency pins above are unchanged. Selected: extend
the already installed recognizer rather than introduce another. Neither upstream
Parser exposes a pending byte representation; vt100 formatting alone omits it,
and vte alone lacks a screen emulator.

`cargo test -p terminal --test library_attach -- --nocapture` initially exited
101 (missing method). The implementation exits 0: every-cut fresh restoration
covers BEL/ST OSC, cursor/erase CSI, parameter/subparameter/intermediate states,
valid/invalid UTF-8 and live callback isolation. No existing test is removed;
clone tests prove in-process checkpoint replay, while these prove fresh byte
restoration. The bounded observer feeds fixed 8192-byte chunks to 1 MiB and
64 MiB for each terminator, observes identical 1027-byte representations and
literal retained titles/later text, and on Linux checks isolated-process RSS
within 1024 KiB of its 1 MiB reading. `cargo test -p terminal` exits 0, retaining
bounded-state, replacement, handled-write and executed-control observers.

Final `just check origin/main` after merging main `3aea34ad4` exits **0**:
1586 Rust tests passed (6 skipped), 61 web tests passed (2 skipped), with lint,
contract freshness and `ALL PROOFS CHECK` passing. No full X14 integration or
matched performance acceptance is claimed by these library observers.

## Screen continuation state (X14 prerequisite, #2160)

The additional licensed vt100 source delta extends `Screen::state_formatted`:

```text
reset margins/origin → saved attributes/cursor → repaint visible cells
                    → drawing margins/origin/cursor → input modes
```

`Grid` reads its existing saved position, saved origin mode and scrolling bounds;
`Screen` reads its existing saved attributes. Private ANSI writers emit DECSTBM
and DECOM beside the existing CUP, DECSC and SGR writers. A saved delayed-wrap
position is established with a temporary last-column space before the repaint.
Final cursor formatting reuses the existing cell/attribute/wide-character path,
with origin-relative CUP coordinates when required. No parser input path, vte
source, dependency configuration or callback changes. The live parser and its
callbacks are neither cloned nor mutated by export.

No retained state is added. Screen output is bounded by the configured visible
rows/columns and their bounded cells, plus fixed cursor/attribute/margin/mode
sequences (the observer allows 128 bytes per cell plus 512 fixed bytes).
Configured scrollback storage remains unchanged; this formatter exports the
visible screen, not scrollback or the inactive alternate grid. Pending recognition
is still exported separately with its existing 1280-byte bound. There is no raw
replay history or additional ANSI/UTF-8 recognizer.

Reuse rechecked 2026-10-16: `gh api` on vt100 main and vte master each exited 0
and returned the same revisions/dates recorded above. The installed
[vt100 Screen](https://docs.rs/vt100/0.16.2/vt100/struct.Screen.html) owns formatting
and private saved/margin state, but upstream `state_formatted` only composes
contents and input modes. Current cursor getters cannot export the saved cursor
or margins. The installed
[vte Parser](https://docs.rs/vte/0.15.0/vte/struct.Parser.html) owns recognition but
has no screen/grid or screen formatter. Selected: extend the pinned vt100
formatter using its state and existing ANSI machinery; neither pending recognition
nor vte alone can restore ground-state screen continuation. Exact package pins,
archive hashes and MIT / Apache-2.0 OR MIT licence texts remain unchanged.

`x14_library_screen_restore_preserves_saved_cursor_and_margins` in
`crates/terminal/tests/library_attach.rs` fails before the patch (exit 101,
`Xbc` versus `abcX`). After the patch it checks both Issue reproductions with
literal contents and cursor results, every byte cut, three exports per cut,
saved bold/red attributes, default/non-default margins, saved/current origin
modes and a saved delayed-wrap position. A later restore/movement/erase probes the retained state; non-Clone
callbacks and continued live parsing check export isolation.

`x14_library_screen_restore_state_is_bounded` fills configured history, installs
saved red/bold cursor state and restricted margins, then overwrites/scrolls with
fixed 8192-byte chunks. At 1 MiB and 64 MiB (beyond the production Output log's
1 MiB cap), exports are identical: 96 bytes for 4×80 with 8 history rows and
144 bytes for 12×40 with 16 history rows; pending is empty. Restored continuation
still writes red/bold `X` at the literal saved position. An isolated Linux
observer checks RSS within 1024 KiB of its 1 MiB reading; observed increases were
40 KiB and 24 KiB. These are library retention observations, not performance
budget evidence. No existing test was removed: pending/OSC export, Clone replay,
replacement, handled-write and executed-control observers prove distinct clauses.

Actual final command exits are retained on #2160 and its PR. Production snapshot
integration, selected transport, parser projection, Contract callers, raw Tauri
bytes, exact xterm observation, flood/journey and matched performance remain #1930.
This prerequisite does not claim full X14 acceptance.

## Screen edit provenance (X14 prerequisite, #2167)

The additional MIT-licensed source delta adds opaque `Option<u64>` source
annotations to the existing `Cell` and `Row` holders. `Screen::set_cell_source`
and `Screen::set_row_source` annotate the active drawing grid and return false
out of bounds. `Cell::source` and `Screen::row_source` read the visible viewport,
including retained history when scrollback is selected. Set scrollback to zero
when reading drawing coordinates. Annotation changes trigger no callback and
change no text, attributes, cursor, visual equality or ANSI formatting.

```text
caller offset → cell/row annotation → vt100's existing grid edits → surviving offset
```

Existing cell/row moves carry annotations, including insertion, deletion,
scrolling, restricted margins and movement into scrollback. New cells/rows start
unannotated. Cell replacement/erasure invalidates that cell's annotation; a full
`Row::clear` also invalidates the row annotation. Partial cell edits preserve
the row marker. Combining codepoints retain the base glyph's origin; wide-cell
cleanup reuses the existing clear paths. The caller owns annotation meaning
and assigns source offsets through the existing handled-text/control callbacks
or explicit screen initialization. No source offset is inferred from an escape
sequence or from equality of rendered text. There is no new recognizer, grid
edit implementation, callback, vte patch or production caller.

Clone preserves annotations with cells/rows and pending recognition, including
inside CSI, OSC and UTF-8. Formatted ANSI export deliberately omits annotations;
this facility supplies in-memory source tracking, not a provenance wire format.
Existing callbacks remain unchanged and default to no-op.

Storage is one eight-byte source value per allocated cell, with presence in
the unused bit of the existing length byte, and one `Option<u64>` per row.
This includes normal and alternate grids and configured retained history.
R3696c compacts the original 48-byte annotated cell to 40 bytes on Linux
x86_64 (the pre-annotation cell was 32 bytes); row annotations remain 16 bytes. No annotation
list, raw byte history, edit queue or per-input allocation is retained. Thus
storage is bounded by configured screen/history dimensions plus the existing
fixed recognizer state. Caller callback storage has its own policy; the test's
callback retains only three u64 values. Its scan for newly written unannotated
cells demonstrates a bounded strategy, not a production projection or latency
claim. #1930 retains production projection, selected streams, full Contract and
caller migration, raw Tauri bytes, flood/journey and matched performance evidence.

`x14_library_observes_screen_edits_for_source_offsets` crosses the installed
interface and asserts the literal blank-row relocation 0/2 → 2/None despite
identical screen/cursor, and repeated-glyph survivors 2 and 3. Table fixtures
assert insertion, deletion, erasure, scrolling, relative cursor movement,
default/restricted margins and hidden OSC finals. Additional observations cover
scrollback viewport versus drawing setters and combining-glyph origin.
`x14_library_screen_edit_observation_survives_checkpoint_replay` compares
bytewise uninterrupted parsing with three independent replays at every cut
through CSI, BEL/ST OSC and UTF-8. It checks source associations, formatted
screen, callbacks, history and original isolation. Literal source assertions
anchor replay comparisons. Its isolated Linux child feeds more than 1 MiB and
64 MiB of writes/edits with 4×16 cells and 8 history rows, checking unchanged
source state, the history bound and RSS within 1024 KiB of the
1 MiB reading. The focused run observed 3044 KiB at both samples (exit 0).

Exact pins and archive hashes above are unchanged: vt100 0.16.2 (MIT), vte
0.15.0 (Apache-2.0 OR MIT). Maintenance rechecked 2026-10-16 via `gh api`
(both exit 0): vt100 main `fc26fd9c3d72f9af8a214741c100920734500de7`,
2025-07-12; vte master `abeae765dd546dfff60b278f0757dcc71beb8ab1`,
2026-02-28. Source anchors are the pinned upstream
[Cell](https://github.com/doy/vt100-rust/blob/fc26fd9c3d72f9af8a214741c100920734500de7/src/cell.rs),
[Grid](https://github.com/doy/vt100-rust/blob/fc26fd9c3d72f9af8a214741c100920734500de7/src/grid.rs),
and [vte Perform](https://github.com/alacritty/vte/blob/abeae765dd546dfff60b278f0757dcc71beb8ab1/src/lib.rs).
Selected: extend the installed vt100 holders so its own implementation moves
source metadata. Upstream vt100's text/attribute-only cells and handled-CSI
callback gap cannot distinguish equal cells/rows; vte's Perform recognizes CSI
but lacks vt100's screen/grid and cannot track those moves. Direct docs.rs
opens were unavailable; installed source and primary GitHub API checks supplied
the evidence. No maintained library supplies the missing seam into this pinned
emulator without a local extension. No new dependency is added.

The initial installed-interface tracer exited 101 (missing annotation methods);
the implemented focused observers exit 0. No existing tests were removed or
edited: prior bounded-OSC, pending attach, replacement, handled text/control
and screen continuation observers prove separate clauses. Final Terminal and
`just check origin/main` exits are recorded on #2167 and its PR.
