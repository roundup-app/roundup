Upstream global-hotkey 0.8.0, as published on crates.io; runtime source is unchanged. Three upstream comment misspellings are corrected
for the repository spelling check.

The only dependency patch is keyboard-types 0.7 → 0.8, matching Tauri 2.12.1's
muda dependency and eliminating a second keyboard vocabulary. This crate uses
Code and Modifiers; supported registration/release is exercised by U3787f's
actual OS observer. Examples are omitted from this library-only vendored copy.
Remove this patch when the selected stable global-shortcut plugin adopts a
release of global-hotkey using keyboard-types 0.8.
