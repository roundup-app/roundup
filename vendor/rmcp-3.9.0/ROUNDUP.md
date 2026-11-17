# Roundup dependency repair (lint-advisories-2026-11)

Source: the published rmcp 3.9.0 crate (https://static.crates.io/crates/rmcp/rmcp-3.9.0.crate),
without its `tests/` directory. Cargo patches crates.io to this directory.

Two changes.

1. `Cargo.toml`: `sha2` 0.11 becomes 0.10. rmcp uses sha2 once
   (`Sha256::digest` in `src/model/skill.rs`), which both majors support, and the
   workspace already holds sha2 0.10 (agents, rupd, tauri-codegen, wry). This keeps
   the dependency graph free of a second sha2/digest/crypto-common version
   (`multiple-versions = "deny"`).
   Remove this change when tauri-codegen and wry move to sha2 0.11.

2. `chrono` becomes `jiff` (RUSTSEC-2026-0543: chrono is unmaintained, no patched
   version; rmcp 3.11.0 still depends on it). rmcp used chrono in four files:
   `Annotations::for_resource`, `with_timestamp` and `with_timestamp_now`
   (`src/model/annotated.rs`, now take `jiff::Timestamp`), `current_timestamp`
   (`src/task_manager.rs`), `now_ms` (`src/model/request_state.rs`) and the
   `Timeout` error text (`src/service.rs`, now the `Duration` debug form).
   Timestamps print as RFC 3339 with `Z` instead of `+00:00`. The `schemars`
   `chrono04` feature goes: `lastModified` is already a `String`. The wasm-only chrono
   dependency goes with it; this workspace builds rmcp for no wasm target.
   Remove this change when an rmcp release drops chrono.

## Reuse

- Selected: rmcp 3.9.0 (https://github.com/modelcontextprotocol/rust-sdk), the
  release that carries the RUSTSEC-2026-0457/-0461/-0462 fixes.
- Selected for the clock: jiff 0.2 (https://github.com/BurntSushi/jiff), the first
  alternative the RUSTSEC-2026-0543 advisory names; already in `Cargo.lock`, so no
  new crate version.
- Alternative: tolerate the duplicate sha2/digest/crypto-common chain in
  `tools/lint/debt.json`; the merge-base ratchet refuses new debt entries.
- Alternative: record RUSTSEC-2026-0543 in `tools/lint/debt.json`; the same ratchet
  refuses an advisory row a PR adds.
- Alternative: stay on rmcp 3.5.1; it carries the three advisories.
