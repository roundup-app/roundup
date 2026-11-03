# App icons

S12 and U5502 (`scenarios/app.md`, `scenarios/ui-state-alerts.md`) describe these marks.

- `artwork.png`: the Dock icon, 1024 px. The B1 drawing on the orange plate (`#E8572A`),
  exported from the pen.dev board "Final — roundup icon" at an 824 px body and centred on
  the macOS icon grid. `just icon` renders `icon.png` from it.
- `social-preview.png`: the same icon beside the wordmark, 1280 by 640 px.
- `menu-bar-glyph.gray`: the menu-bar mark's 🤌 glyph, 36 by 36 bytes of 8-bit alpha, row
  by row. It is the E3 glyph from the same board, exported at 2x for the 18 pt menu bar.
  `crates/desktop/src/menu_bar.rs` adds the state dot at the fingertips.

## Noto Emoji

The 🤌 glyph is rendered from Noto Emoji, Google's monochrome emoji font (copyright 2013,
2022 Google Inc.), under the SIL Open Font License 1.1, at weight 400.

- Font: https://github.com/google/fonts/tree/main/ofl/notoemoji
- Upstream: https://github.com/googlefonts/emoji-bw
- Licence: https://openfontlicense.org/open-font-license-official-text/

pen.dev supplied the font, so the exact release used is unknown.
