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
