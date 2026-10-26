Official tauri-plugin-window-state 2.5.0 (MIT OR Apache-2.0), downloaded from crates.io.

Local patch for U3787e:
- Keep the existing file/cache/lifecycle as the sole persistence holder. Store source
  scale with physical normal bounds (old files default to scale 1).
- Restore logical bounds before reveal, clamp minimum width, validate dimensions
  and scale, and fall back to an available monitor's work area.
- Track only normal move/resize geometry, preserving it during zoom/fullscreen.
- Correct overlay-titlebar height when saving on macOS (upstream v2 source fix).
- Report read/restore/save failures. An unreadable file is retained without overwrite.
- Emit window-state-restored before reveal for native observers; visibility is not
  restored because the main window must always open. First launch maximizes only
  after retaining its initial normal bounds.

Production registration filters to main; Capture is never tracked. No frontend ACL
permission is granted. Tests run through desktop::build in the s2297a native harness.
