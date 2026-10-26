Official tauri-plugin-deep-link-2.6.2 release from crates.io, MIT OR Apache-2.0.

roundup is a macOS App. This copy compiles only on macOS and removes the unused
Linux dependency from its manifest. All upstream macOS behavior is unchanged.
The Linux dependencies otherwise add unmaintained zbus 5 companion crates
(single-instance) and a conflicting rust-ini/hashbrown graph (deep-link).
No Linux native launch support is claimed. Keep license notices with this copy.
