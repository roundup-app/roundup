# Roundup dependency repair (#1926)

Source: the complete published rusqlite 0.40.2 crate from
https://static.crates.io/crates/rusqlite/rusqlite-0.40.2.crate.
Cargo pins the version and patches crates.io transitively to this directory;
rusqlite_migration therefore uses the same Connection type. No SQLite C source
or libsqlite3-sys dependency changes.

The repair moves SQL-key initialization into the successful cold-prepare arm.
Warm checkout retains the existing allocation. Cache return, clear bindings,
reset, eviction and schema reprepare are unchanged. The measurement motivating
this repair is #1926 and #1924's linked cache attribution; diagnostics alone are
not evidence of an uninstrumented improvement.

Remove this patch after a maintained upstream release carries the correction,
then rerun the allocation regression and Agents/Message acceptance. Preserve the
version pin until that review. Do not edit upstream sources beyond src/cache.rs.

## Reuse

- Selected: rusqlite 0.40.2 (released 2026-08-08),
  https://github.com/rusqlite/rusqlite/releases/tag/v0.40.2.
  Both that release and upstream master still replace the key on warm checkout.
  Cargo's supported local patch delivery preserves the public interface:
  https://doc.rust-lang.org/cargo/reference/overriding-dependencies.html#testing-a-bugfix.
- SQLx is actively released at https://github.com/transact-rs/sqlx/releases.
  It cannot supply rusqlite's Connection/Statement/prepare_cached types to
  rusqlite_migration or existing callers; migration changes the prohibited
  constructor/caller and SQL execution scope.
- self_cell 1.3.0 (https://docs.rs/crate/self_cell/1.3.0) and ouroboros 0.18.5
  (https://docs.rs/crate/ouroboros/0.18.5) maintain self-referential holders,
  but cannot make rusqlite Statement Send; they fail the existing cross-thread
  Rail requirement and do not correct the dependency's warm checkout.

Vendoring adds upstream code in one dependency directory. It avoids a new
runtime holder, protocol, parser or cache; the authored production repair is
confined to the existing cache function.
