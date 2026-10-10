# SQLite (WAL) for state; Pads as markdown

Status: Accepted

## Decision

`rusqlite` in WAL mode for Todos, Pad index, Touch log, Routes, Agent tree. Pads app-only by default; per-Project setting stores them as `.md` files in `.roundup/pads/`.

Amended 2026-10-10 (D8): the databases live in the Project data folder under the App's data folder, not in the Project's `.roundup/`, which no longer exists; Pad files are `<Project folder>/roundup-pads/<name>.md`.

## Considered

Plain JSON files, sled, Postgres.

## Why

Blocker graph and append-only Touch log want transactions and queries. Markdown files keep Pads git-friendly when the user opts in.

## Notes

Terminology: the table and RPC names say Pad, never scratchpad or session (rule 6).
