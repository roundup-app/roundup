Source: https://crates.io/crates/libappindicator-sys/0.9.0
Upstream source revision: eafd1e3682a1247f595410266091e9684021cb6f (sys/)

Source: crates.io libappindicator-sys 0.9.0. The bindings are unchanged.
Only Cargo.toml changes libloading 0.7 to 0.8, using the workspace loader
version for Tauri’s Linux tray backend. Library::new and Library::get retain
the APIs these bindings use. Remove this patch when upstream updates.
