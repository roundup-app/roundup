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
