# Roundup dependency repair (lint-advisories-2026-11)

Source: the published rmcp 3.9.0 crate (https://static.crates.io/crates/rmcp/rmcp-3.9.0.crate),
without its `tests/` directory. Cargo patches crates.io to this directory.

The only change is `Cargo.toml`: `sha2` 0.11 becomes 0.10. rmcp uses sha2 once
(`Sha256::digest` in `src/model/skill.rs`), which both majors support, and the
workspace already holds sha2 0.10 (agents, rupd, tauri-codegen, wry). This keeps
the dependency graph free of a second sha2/digest/crypto-common version
(`multiple-versions = "deny"`).

Remove this patch when tauri-codegen and wry move to sha2 0.11.

## Reuse

- Selected: rmcp 3.9.0 (https://github.com/modelcontextprotocol/rust-sdk), the
  release that carries the RUSTSEC-2026-0457/-0461/-0462 fixes.
- Alternative: tolerate the duplicate sha2/digest/crypto-common chain in
  `tools/lint/debt.json`; the merge-base ratchet refuses new debt entries.
- Alternative: stay on rmcp 3.5.1; it carries the three advisories.
