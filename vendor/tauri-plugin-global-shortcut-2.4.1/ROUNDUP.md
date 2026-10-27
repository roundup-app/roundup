# Dependency compatibility patch

Published tauri-plugin-global-shortcut 2.4.1 source from crates.io, under its
included MIT/Apache-2.0 licences. Only the `global-hotkey` requirement in
`Cargo.toml` and `Cargo.toml.orig` changes from 0.8 to 0.9. Blank lines
in the bundled JavaScript satisfy the repository spacing lint without changing behavior. Two comment spellings satisfy the typo lint.
The Fallow entry declares the bundled script loaded by `build.rs`, outside
the JavaScript import graph. Upstream 0.9 uses
keyboard-types 0.8 without the old global-hotkey vendor's SUPER diagnostics.

The workspace patch serves desktop tests and the macOS native integration.
Remove it when a stable plugin release accepts global-hotkey 0.9.
