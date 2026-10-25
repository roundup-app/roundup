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

The selected publication I/O design in `scenarios/test-cost.md`, R3778a–R3778e,
keeps identity/quota/access metadata in the existing WAL transaction and makes new
payload files durable before committing their references. Existing BLOBs stay
readable without startup conversion. This physical representation is **proposed,
not authorized for implementation**: an Architect or the user must authorize the
payload ownership expansion and the corresponding physical-storage amendment to
DV2 before #3942 implements it. WAL remains the accepted decision; this amendment
permits neither a second database nor weaker publication atomicity/durability,
Event guarantees, owner-read leases, quotas or public snapshot observers.
