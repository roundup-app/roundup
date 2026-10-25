# SQLite for state; Pads as markdown

Status: Accepted

## Decision

`rusqlite` owns state transactions. Standalone Todos, Pad index, Touch log, Routes and Agent stores use WAL. The Daemon initializes the shared `project.db` before opening any owner; every Project writer uses SQLite's native PERSIST rollback journal with EXTRA synchronization. Pads app-only by default; per-Project setting stores them as `.md` files in the Project's data folder (`pads/`), not the Project folder.

Amended 2026-10-10 (issue 749): the databases and Pad files moved from the Project's `.roundup/` to `<app data>/projects/<key>/` (N1), so opening a Project writes nothing to it.

Amended 2026-10-25 (#3942): 32 actual 32 MiB publications through the production Daemon wrote 2,170,810,368 bytes in WAL mode, retaining 1,109,230,152 bytes. Coordinated PERSIST/EXTRA wrote 1,093,640,192 bytes, retaining 1,075,373,576 bytes. Transactions took 12.194 s and 9.034 s respectively on the same Linux runner. This removes the duplicate payload write; it does not meet #3904's five-second requirement.

## Durability and recovery

[SQLite documents](https://sqlite.org/pragma.html#pragma_synchronous) rollback/EXTRA and WAL/FULL as ACID. EXTRA also syncs the containing directory if SQLite unlinks a rollback journal. PERSIST normally commits by synchronizing an invalidated journal header, avoiding DELETE's unlink. Never use WAL's NORMAL setting for a rollback writer: even the Event log uses EXTRA. SQLite's [atomic commit and recovery](https://sqlite.org/atomiccommit.html) remain responsible for interrupted transactions, hot journals and existing WAL recovery. No files are parsed, repaged or rewritten outside SQLite to change journal mode.

The initializer recovers and leaves WAL before opening stores. PERSIST and synchronous settings are connection-local, so store connection/schema helpers select them before any Project write, including migrations, publication, reactions, Events, Rail, Todos, Pads, Checkpoints, Touches, Messages, Digest cursors, Asks and measurement timing. No later opener selects WAL for a Project. Standalone schema paths continue to select WAL, with their existing synchronization settings.

The existing legacy data-folder mover carries `-journal` companions alongside `-wal` and `-shm` before opening SQLite; leaving a hot rollback journal behind would lose recovery and prevent N3 from emptying the old folder.

The prebuilt image and migration sequence stay unchanged. A fresh image still carries WAL; initialization converts it through SQLite before store opening. This conversion is included in startup measurements. Ten alternating baseline/head starts measured medians 14.661/18.211 ms fresh and 11.559/13.638 ms reopened, including process launch and readiness; both remain below 300 ms. Fresh conversion adds SQLite synchronization (six fsync calls including image seeding versus one on baseline). Reopened rollback connections also perform more locking and schema reads: a separate syscall-count probe saw fcntl 167→312, pread64 92→196 and openat 44→93, with no reopen fsync. These counts explain the startup tradeoff; traced elapsed times are not speed comparisons. Event writes also pay EXTRA synchronization instead of WAL/NORMAL. Never hide these costs by changing budgets or excluding conversion from accounting.

## Concurrency

SQLite serializes writers and briefly excludes readers during rollback writes. Existing transaction boundaries and busy bounds remain unchanged. The schema-only owner-read worker grants leases only when `wal_checkpoint(PASSIVE)` reports a completed WAL backfill; outside WAL its frame count is negative, so it holds no read transaction and cannot block a rollback writer. It retains its bounded wake queue and shutdown. Public RPC publication alongside Project reads/writes and owner reads must complete without busy refusals or missing durable Events; standalone WAL/read-lease observers remain required.

## Considered

WAL retains concurrent snapshots but duplicates large appended publication payload writes through the WAL and main database. Increasing checkpoint intervals did not remove those writes (#3942). DELETE/EXTRA preserves durability but adds directory synchronization on each unlink; DELETE/FULL does not guarantee the previous publication durability. PERSIST/EXTRA uses the installed SQLite commit implementation without another store or dependency.

The original alternatives were plain JSON files, sled and Postgres. Blocker graph and append-only Touch log need transactions and queries. Markdown files keep Pads git-friendly when the user opts in.

## Notes

Terminology: the table and RPC names say Pad, never scratchpad or session (rule 6).
