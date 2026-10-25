# Roundup dependency repair (#1926)

Source: the complete published rusqlite 0.40.2 crate from
https://static.crates.io/crates/rusqlite/rusqlite-0.40.2.crate.
Cargo pins the version and patches crates.io transitively to this directory;
rusqlite_migration therefore uses the same Connection type. No SQLite C source
or libsqlite3-sys dependency changes. The vendored upstream lockfile is retained
for standalone cache tests. Resolving the workspace patch also repairs the
existing cssparser-macros 0.7.1 lock edge from syn 3 to its declared syn 2;
no package version changes.

The repair moves SQL-key initialization into the successful cold-prepare arm.
Warm checkout retains the existing allocation. Cache return, clear bindings,
reset, eviction and schema reprepare are unchanged. The measurement motivating
this repair is #1926 and #1924's linked cache attribution; diagnostics alone are
not evidence of an uninstrumented improvement.

Remove this patch after a maintained upstream release carries the correction,
then rerun the allocation regression and Agents/Message acceptance. Preserve the
version pin until that review. Do not edit upstream sources beyond src/cache.rs.

Upstream archive SHA-256:
`23f2a97da3e3873c73cb2a2e71b35c40ff95e0b1eefa8d72d8499a6928c3b5b3`.

Test reduction: upstream `test_cache_key` repeated `test_cache` with surrounding
whitespace. `b32_r16_warm_checkout_retains_sql_key` now proves trimmed-key reuse
and retained allocation, while `test_cache` retains cache checkout/return proof.

The prerequisite leaves #1924 open for its complete matched owner and
User/Extension/User observations. #1366, #1361 and #1251 keep their existing
ceilings and workloads.

## Reuse

- Selected: rusqlite 0.40.2 (released 2026-08-08),
  https://github.com/rusqlite/rusqlite/releases/tag/v0.40.2.
  Both that release and upstream master still replace the key on warm checkout.
  Cargo's supported local patch delivery preserves the public interface:
  https://doc.rust-lang.org/cargo/reference/overriding-dependencies.html#testing-a-bugfix.
- SQLx v0.9.0 is tagged 2026-05-21, with upstream activity on 2026-10-15:
  https://github.com/transact-rs/sqlx/tree/v0.9.0 and
  https://github.com/transact-rs/sqlx/commits/main/.
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

## Z3802c: rusqlite 0.41.0 does not carry the repair (2026-10-25)

Pin and vendor stay. Source: https://static.crates.io/crates/rusqlite/rusqlite-0.41.0.crate
(SHA-256 `9c026b4444579e8d754556c6c75d040d69c4a44283cdb648ab8a8d5965c2cfa8`).

- Missing capability: `grep -rn with_cached_rows rusqlite-0.41.0/src` exits 1.
  Upstream has no scoped cached rows, so `crates/agents/src/rail/view.rs` (the
  one caller) cannot compile against it and the `r16_cached_rows_*` probes
  have nothing to port to.
- Missing correction: `StatementCache::get` in 0.41.0 `src/cache.rs` still calls
  `set_statement_cache_key(trimmed)` on the warm arm, replacing the key on every
  checkout.
- SQLx stays rejected for the reasons above: it cannot supply rusqlite's types to
  `rusqlite_migration`.

Remove this patch when a release carries both; rerun the `r16_cached_rows_*`
tests, `just perf` and the owner-read observer then.
