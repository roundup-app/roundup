# Migration fixtures

Baseline main: `a5acc58760fc744b4a65f0a4cda5fef08d9cb31c`. Schema creation uses that checkout's `rupd::Daemon::open`; the generator closes it, executes every `*.seed.sql`, checkpoints WAL, and closes each connection. Every application table is non-empty. The Rail is stopped, its Terminal ids are NULL, every Todo has a Change, and held Messages use `ask_first`, so ordinary startup recovery preserves these fixtures.

Reproduce from the implementation checkout into a **new empty output directory**:

```sh
git worktree add --detach /tmp/roundup-fixture-main a5acc58760fc744b4a65f0a4cda5fef08d9cb31c
mkdir -p /tmp/roundup-fixture-main/crates/rupd/examples
cp crates/rupd/tests/fixtures/store-migrations/generate.rs /tmp/roundup-fixture-main/crates/rupd/examples/migration_fixtures.rs
# Replace /absolute/implementation with this checkout's absolute path.
cd /tmp/roundup-fixture-main
cargo run -p rupd --example migration_fixtures -- /tmp/roundup-fixture-output /absolute/implementation/crates/rupd/tests/fixtures/store-migrations
```

The checked-in `.db` files contain the output of that command, generated at this baseline, before migration 1. Tests compare all stored SQLite values (including sequences and payloads), plus schema definitions covering defaults, indexes, keys and constraints. Boundary tests run before recovery; the Daemon tests repeat the comparison after full open and reopen.

Inventory reviewed (all opens call `schema::open`, which calls `rusqlite_migration::Migrations::to_latest`; Digest uses `digest_schema`):

| Database | Owning migration definition | Embedded current SQL |
| --- | --- | --- |
| Todos | `crates/todos/src/schema.rs` | `crates/todos/migrations/001/up.sql` |
| Agents | `crates/agents/src/schema.rs` | `crates/agents/migrations/001/up.sql` |
| Checkpoints | `crates/checkpoints/src/schema.rs` | `crates/checkpoints/migrations/001/up.sql` |
| Messages | `crates/messages/src/schema.rs` | `crates/messages/migrations/001/up.sql` |
| Digest | `crates/messages/src/digest_schema.rs` | `crates/messages/migrations/001-digest/up.sql` |
| Pads | `crates/pads/src/schema.rs` | `crates/pads/migrations/001/up.sql` |
| Provenance | `crates/provenance/src/schema.rs` | `crates/provenance/migrations/001/up.sql` |

Only migration 1 has bootstrap probes for pre-versioned databases. Its historical SQL is embedded beside `up.sql` and runs in the library's transaction. Future changes append `002/up.sql`, `003/up.sql`, etc. and a corresponding `M::up(include_str!(...))` to the store's migration list; migration 1 stays immutable. Connection PRAGMAs and runtime recovery stay outside migration definitions.
