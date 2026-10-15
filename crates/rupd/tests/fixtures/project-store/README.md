# Project database import fixtures

Main SHA: `ef37937d8aa12e73ca4db6a06708e99791d6b48a`. These seven databases were created with that checkout's real `Daemon::open`, then populated with the existing store-migration seed SQL. Every application table has rows, including both Rail and Pad settings, deleted-id sequence gaps, Todo Changes and blockers, ordered Touches, Message Routes and reservations, Digest cursors, Checkpoints and Marks. Tests compare typed values and sequences before runtime recovery.

Reproduce into an empty output directory:

```sh
git worktree add --detach /tmp/roundup-project-db-baseline ef37937d8aa12e73ca4db6a06708e99791d6b48a
mkdir -p /tmp/roundup-project-db-baseline/crates/rupd/examples
cp crates/rupd/tests/fixtures/store-migrations/generate.rs /tmp/roundup-project-db-baseline/crates/rupd/examples/project_store_fixtures.rs
cd /tmp/roundup-project-db-baseline
cargo run -p rupd --example project_store_fixtures -- /tmp/project-store-output /absolute/implementation/crates/rupd/tests/fixtures/store-migrations
```

Baseline: 7 active mains; 14 WAL/SHM companions while open; 0 retained sources. Consolidated fresh Project: 1 active main; 2 companions while open; 0 retained sources. Imported Project: 1 active main; 2 active companions; 7 retained source mains. The checkpointed import fixture retains zero source companions; the WAL fixture retains its source WAL and SHM. Source companions are retained separately when present; they are neither active stores nor counted as main databases. A source with committed WAL is tested with its connection held open and auto-checkpoint disabled.

Production schema changes append numbered SQL under `crates/rupd/migrations/`. The per-store migration definitions remain the legacy import definitions; the importer runs them on in-memory SQLite backups before copying. Legacy source files are never migrated in place.
