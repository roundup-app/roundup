# Store migrations

Module: schema and open code in `crates/todos`, `crates/agents`, `crates/checkpoints`, `crates/messages`, `crates/pads`, `crates/provenance` and `crates/rupd`; removal of `crates/rpc/src/migrate.rs` and its callers. Terms: Project data, Daemon, Todo, Pad, Touch, Agent, Checkpoint, Message (`GLOSSARY.md`). Acceptance for #1662, the implementation follow-up to #1617. No RPC, App seam or Message delivery change; M1–M10 remain unchanged.

Scope includes Pads and Provenance because “every store” includes their schema/open code. Do not change Checkpoint content storage (#1616), `crates/agents/src/worktree.rs` (#1618), database consolidation (#1642), or N3's file move. The App's non-SQLite settings are outside this scope.

Baseline: `origin/main` at `d5ada596` (the implementation records its fetched main SHA too). The current schemas are defined by these opens; fixtures must be written by those baseline opens, not by the new migrations:

| File | Baseline schema/open code |
| --- | --- |
| `todos.db` | `crates/todos/src/store.rs:23` |
| `agents.db` | `crates/agents/src/rail.rs:18` |
| `checkpoints.db` | `crates/checkpoints/src/lib.rs:26` |
| `messages.db` | `crates/messages/src/store.rs:76` |
| `digest.db` | `crates/messages/src/digest.rs:98` |
| `pads.db` | `crates/pads/src/store.rs:18` |
| `provenance.db` | `crates/provenance/src/lib.rs:15` |

**N9 every store uses versioned SQL.** Given each store above, when it opens a new database, then its current schema is migration 1, loaded from a numbered SQL file under its owning crate's `migrations/` directory and applied by one selected library, `rusqlite_migration` or `refinery` (`n9_each_store_creates_current_schema`, parameterized over all seven files; compares application columns, defaults, indexes, keys and constraints with baseline-created databases; excludes library-owned metadata). The same migration definition is used by any in-memory open (`n9_in_memory_uses_the_same_schema`).

Policy: remove hand-written schema creation, column adoption and schema-version progression from store opens and delete `crates/rpc/src/migrate.rs` with its export and callers; connection setup such as WAL stays connection setup. Every schema change thereafter adds a numbered SQL migration rather than editing migration 1. Historical upgrades already accepted by main remain supported by the library's migration/bootstrap facilities and versioned SQL; do not replace them with a new custom migration engine. The implementation PR's `Reuse:` section compares both libraries' rusqlite compatibility, SQL embedding, existing-schema adoption and transaction/error behaviour, cites their documentation, and names the choice (#1598).

**N10 existing data is adopted without change.** Given a non-empty database of each kind written and closed by the recorded main checkout, when the new store applies migration while opening the same path, then all application tables, rows, primary keys, sequence values and stored payloads equal their baseline values, and the library records migration 1 without duplicating, clearing or rewriting application data (`n10_adopts_each_main_database_without_data_change`). Seed every application table, including settings, Todo Changes/blockers, Message Routes/reservations/generations/iterations/chains, Digest cursors and Checkpoint Marks; record the baseline SHA and fixture creation command with the fixtures. Compare at the production migration boundary before ordinary startup recovery; library-owned migration metadata is excluded. Full-open fixtures use a stopped Rail with NULL Terminal ids and complete Todo Changes, so unchanged startup cleanup does not obscure migration effects (`n10_adopts_each_main_database_without_data_change`). Preserve main’s runtime recovery, including the Rail clearing stale Terminal ids (`crates/agents/src/rail.rs:89`), rather than turning per-open recovery into a one-time SQL migration (policy).

When that database opens a second time, then migration 1 is not reapplied and the same comparison holds (`n10_reopen_is_idempotent`). When a supported older schema fixture from main's existing tests opens, then its existing acceptance still holds (`n10_supported_older_schemas_still_upgrade`, retaining the original scenario tests); unsupported or malformed schemas continue to fail rather than erasing data (`n10_invalid_schema_preserves_data`).

**N11 migration failure leaves data recoverable.** Given a copy of each baseline fixture and a test-only next migration that writes a row then fails with invalid SQL, when the library applies it, then the open fails with an error naming the database and migration, application rows and committed migration version remain as before, and reopening with only migration 1 reads the original data (`n11_failed_migration_rolls_back`, parameterized over the seven stores). Test through the production migration boundary; no production test-only RPC is added.

Regression: N1–N4 in `scenarios/project-data.md:5`, `:7`, `:9`, `:11` remain required, including the legacy folder move before stores open. Run their `n1_`, `n2_`, `n3_`, `n4_` tests through the built Daemon; migration-library metadata must not change file placement or overwrite conflicting Project data. Existing schema-upgrade tests remain required alongside N9–N11.

Observer (policy): from the implementation checkout, `rg -n 'user_version' crates --glob '!*/migrations/*'` has no application-owned version reads/writes; exit 1 with no rows is a pass because dependency source lives outside `crates`. Any match must be a library invocation, never manual PRAGMA progression. Inspect every inventory row for its library call and embedded SQL file; an empty search alone does not prove adoption. `loop/rules.sh vocab` and `just check` pass. No Mac observation is required.
