# SQLite (WAL) for state; Pads as markdown

Status: Accepted

## Decision

`rusqlite` in WAL mode for Todos, Pad index, Touch log, Routes, Agent tree. Pads app-only by default; per-Project setting stores them as `.md` files in the Project's data folder (`pads/`), not the Project folder.

Amended 2026-10-10 (issue 749): the databases and Pad files moved from the Project's `.roundup/` to `<app data>/projects/<key>/` (N1), so opening a Project writes nothing to it.

## Considered

Plain JSON files, sled, Postgres.

## Why

Blocker graph and append-only Touch log want transactions and queries. Markdown files keep Pads git-friendly when the user opts in.

## Notes

Terminology: the table and RPC names say Pad, never scratchpad or session (rule 6).

Amended 2026-10-25 (#3961): preserve Project WAL snapshot concurrency. A retained
Pad reader must continue seeing its old snapshot while public Pad writes commit;
DELETE/PERSIST/TRUNCATE require that reader to leave. Synchronization strength
cannot repair the locking conflict. Moving WAL checkpoints also retains the
payload's eventual WAL-to-database write. See [SQLite isolation](https://sqlite.org/isolation.html)
and [WAL mechanics](https://sqlite.org/wal.html).

Amended 2026-10-25 (#3964): [User authorization](https://github.com/roundup-app/roundup/issues/3964#issuecomment-6394909828)
approves R3778b's physical payload representation and exact implementation file
set in `scenarios/test-cost.md`. Publish through one public operation and one
metadata visibility point: make each new local payload's private immutable file
and its directory entry durable before atomically committing the record and
payload reference in the existing Project WAL transaction with FULL or stronger
synchronization. Existing BLOB payloads remain readable and quota-charged in
place, without startup conversion. SQLite remains the sole authority for
metadata, identity, access, replay and quota. R3778b–R3778e retain the exact file
set, file-before-reference power-loss ordering, additive migration, bounded
pending-file recovery, tombstone-before-unlink cleanup and mixed-format quota
accounting. #3942 may implement only after this specification amendment merges;
this specification delivers no implementation acceptance.

WAL remains the accepted decision. This authorization grants no second database,
dependency, compression/deduplication, contract, product or frozen-loop change,
and weakens no publication atomicity/durability, Event guarantee, bounded owner
read, standalone lease, quota or public retained-snapshot observer. R3778a–R3778e
and DV1–DV4 remain required, including all 32 real 32 MiB publications, exact
limits, replay/conflict, revocation, pre/post-commit crashes, metadata-only proof,
migration/recovery, ten alternating baseline/head pairs and unchanged performance
budgets. #3904 remains open for separate under-five-second and implementation-head
CI acceptance; #3872/#3809 remeasure the complete repair.
