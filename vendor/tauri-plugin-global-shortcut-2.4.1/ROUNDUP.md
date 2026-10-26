Upstream tauri-plugin-global-shortcut 2.4.1 from crates.io, with unchanged runtime behavior.
Two documentation misspellings and JavaScript blank-line spacing are corrected
for the repository lint checks.

The only dependency patch is global-hotkey 0.8 → 0.9, whose upstream
keyboard-types 0.8 dependency removes the need to vendor global-hotkey.
Both the native macOS capture owner and desktop OS-registration tests use
this workspace patch. Remove it when a stable shortcut plugin accepts
global-hotkey 0.9. Z4280a retains the existing U3787f and U3804 observers.
