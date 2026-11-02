# Storage migration order

Specification for #4522. Terms: Project, Project data, Pad, Daemon (`GLOSSARY.md`). This specifies one bounded repair and a CI guard; it adds no RPC, App seam, migration engine or general pre-release adoption promise (policy).

**B4522 migration additions never move an applied position.**

## Repair retired

Policy: N5467a–d (`scenarios/local-data-retirement.md`, #5467) retire B4522's historical-prefix opens, skipped-Pad repair, retained-deletion upgrade fixture and exception to N20. Remove `b4522_earlier_project_versions_support_pad_deletion`, `b4522_skipped_pad_migration_recovers_on_open` and `b4522_existing_pad_deletion_survives_repair` when implementing #5467. Obsolete stores are refused; fresh creation still applies the existing SQL sequence from empty input. The filename-only CI guard below remains required.

## CI guard

Policy: run a filename-only guard in a required `check` lane before Rust compilation. Use the PR's checked target-base tree (the first parent of CI's merge checkout), not its head or its first authored commit. Compare base and proposed trees directly. A missing/unreadable base fails visibly with a nonzero exit; main pushes still run the complete duplicate-prefix audit. A single invocation, including fixture tests, completes within five seconds on CI without compiling Rust, installing dependencies, opening a database or starting an App/Daemon.

Policy: discover every tracked migration directory, including a newly added one. An entry is a direct numbered SQL file or a numbered child directory containing `up.sql`; nested `project/` is its own set, never an entry of its parent. Compare entry names bytewise, exactly as the Project loader does. A prefix is the leading decimal integer, so different zero padding does not create another prefix. Check each directory separately; equal numbers in different directories do not conflict.

| Proposed tree relative to its base | Required result | Planned guard fixture |
| --- | --- | --- |
| Every added entry sorts strictly after its directory's base maximum and all new prefixes are unique | Exit 0 | `b4522_guard_accepts_appended_migrations` |
| Added entry sorts at or before its directory's base maximum | Nonzero; diagnostic names directory, entry and base maximum | `b4522_guard_rejects_inserted_migrations` |
| Added entry reuses an existing prefix, even when its suffix sorts after the maximum | Nonzero; diagnostic names both conflicting paths | `b4522_guard_rejects_duplicate_prefixes` |
| Two added entries share a prefix, including in a new directory with no base entries | Nonzero; diagnostic names both conflicting paths | `b4522_guard_rejects_duplicate_prefixes` |
| No new conflict; only the exact historical duplicate groups below remain | Exit 0 | `b4522_guard_accepts_only_recorded_duplicates` |
| Any historical group gains another member, or another duplicate group appears | Nonzero; diagnostic names the conflicting paths | `b4522_guard_accepts_only_recorded_duplicates` |
| Base tree cannot be read | Nonzero; diagnostic identifies the unavailable base | `b4522_guard_refuses_missing_base` |

Each filename fixture is parameterized over both SQL-file and numbered-directory layouts, including `crates/pads/migrations/` and a newly introduced migration directory. The guard must inspect all directories even when a PR changes only one. Its fixture input trees are temporary local Git objects; no network, browser or real application process is needed (policy).

Policy: the sole duplicate exceptions are these exact pre-existing path groups, relative to their named directory. No wildcard, maximum-prefix exemption or automatic expansion from the current base is allowed. A PR cannot bless its own new collision by editing an exception. Keep the exception inventory and its fixture in the guard's module.

| Directory | Prefix | Exact existing members |
| --- | --- | --- |
| `crates/rupd/migrations/project/` | 15 | `0015-message-results.sql`, `0015-todo-change-actor.sql` |
| `crates/rupd/migrations/project/` | 20 | `0020-continuations.sql`, `0020-todo-refs.sql` |
| `crates/rupd/migrations/project/` | 23 | `0023-agent-finished.sql`, `0023-measurement-no-tokens-or-money.sql`, `0023-remove-decisions.sql` |
| `crates/rupd/migrations/project/` | 26 | `0026-pad-deletions.sql`, `0026-todo-deletions.sql` |
| `crates/messages/migrations/` | 1 | `001/up.sql`, `001-digest/up.sql` |

Policy: Messages' two `001` entries belong to independent Message and Digest sequences (`schema::open` and `digest_schema::open`); the explicit exception preserves both without granting new duplicates. The audit also covers `crates/agents/migrations/`, `crates/checkpoints/migrations/`, `crates/pads/migrations/`, `crates/provenance/migrations/`, `crates/rupd/migrations/` and `crates/todos/migrations/`; these contain no other duplicate prefixes at specification time. Future position-applied sets receive the same guard automatically. For explicit Rust lists, append new entries after existing ones as well as choosing an appended filename (policy).

## Checks and observers

Applicable Gates (policy): N5467's refusal preserves obsolete data; current Pad publication identity and revocation remain required under P12. The retired repair no longer supplies an observer.

Required checks (policy; existing anchors on main):

1. `crates/rupd/build.rs`, `main` and `fresh_image`, and `crates/rupd/src/storage.rs`, `migrations`: preserve the fresh SQL/image creation sequence, not runtime upgrades.
2. `crates/rupd/src/storage_tests.rs`, `r3696c_a_fresh_project_db_equals_the_migrated_one_with_its_own_identity`: retain fresh-from-empty equivalence and distinct identities; N5467c retires its historical suffix/rollback subcase.
3. `crates/rupd/tests/store_migrations.rs`, `n20_current_store_opens`: preserve current store operations.
4. `scenarios/merge-conflict-spots.md`, heading “N21 one file per migration”: retain file discovery and clean concurrent additions for fresh creation.

Policy: N5467 retires the repair observers; the filename guard's local fixtures observe CI refusal. No UI, rendered capture or Mac-only observation is required. The implementation records the audited base SHA, all discovered migration directories and duplicate groups on its Issue. Run `just ready`, affected Rust tests and the guard fixtures; report one row per failed command with its exit code. Exit 0 passes, every other exit fails. Specification validation runs `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`; both must exit 0. No scenario Work table holds progress or engineering questions.

## Refuse databases from newer builds

**N5088a a newer database is refused at open.** Work order: [#5088](https://github.com/roundup-app/roundup/issues/5088). For each migration owner below, let `known` be the number of entries in its current production migration sequence and `stored` be SQLite's `PRAGMA user_version`. Given a file-backed database with `stored = known + 1`, when its normal storage open runs, then open returns an error identifying the database path, `stored` as the database version and `known` as the maximum this build supports, and explaining that the database came from a newer or branch build (the corresponding `n5088a_` test below). The error must distinguish the two versions; a migration target alone is insufficient. Refusal happens before applying migrations or reading application tables, so a missing table or column cannot replace this error (same tests).

| Migration owner on main | In-process regression test to implement |
|---|---|
| Project: `crates/rupd/src/storage.rs`, `open` / `migrations` | `n5088a_project_refuses_a_newer_database` |
| Agents: `crates/agents/src/schema.rs`, `open` | `n5088a_agents_refuses_a_newer_database` |
| Todos: `crates/todos/src/schema.rs`, `open` | `n5088a_todos_refuses_a_newer_database` |
| Pads: `crates/pads/src/schema.rs`, `open` | `n5088a_pads_refuses_a_newer_database` |
| Messages: `crates/messages/src/schema.rs`, `open` | `n5088a_messages_refuses_a_newer_database` |
| Digest: `crates/messages/src/digest_schema.rs`, `open` | `n5088a_digest_refuses_a_newer_database` |
| Provenance: `crates/provenance/src/schema.rs`, `open` | `n5088a_provenance_refuses_a_newer_database` |
| Checkpoints: `crates/checkpoints/src/schema.rs`, `open` | `n5088a_checkpoints_refuses_a_newer_database` |

Each test creates a temporary SQLite file, sets `user_version` to one above the production count, closes the setup connection and invokes the real storage open. An otherwise empty database makes refusal before application SQL observable. Assert the returned error's path, both version values and newer/branch explanation; reopen through raw SQLite to assert `user_version` is unchanged and no application tables were created (same tests). Derive `known` from the production sequence, not a second copied inventory or a fixed version number. The Project count includes its frozen ten-entry head plus every discovered added migration, rather than the highest SQL filename prefix (policy).

Policy: one in-process test per migration owner; call the existing storage open seam, including schema `open` where that is the migration boundary. No App, browser, real Daemon process, vendor process or clock is needed. Standalone stores use standalone filenames: their existing `project.db` bypass remains valid because the Project migration owner guards the shared database first. Do not compare a shared Project version against a shorter standalone sequence. Audit all production `user_version` / `to_latest` owners at the implementation base and include any additional owner found, with one equivalent test (policy).

Policy: preferences are audited, not converted. `apps/desktop/src/settings/preferences.ts`, `appSettings`, uses `storedValue` from `apps/desktop/src/state/storage.ts`, backed by the Tauri store's `work.json`; `crates/desktop/src/store.rs`, `Store`, keeps Project preferences in `projects.json`. Neither migrates SQLite `user_version`, so neither gets a fabricated SQLite guard or regression. Record any changed finding on the Issue. The build-time fresh-image generator in `crates/rupd/build.rs` creates a new database; it is not an opener of user data (policy).

**N5088b the Project reports the refusal instead of a later SQL error.** Policy: a failed Project open propagates N5088a's complete diagnostic through the existing Daemon startup error and App Project-open/reopen failure surface. The affected Project shows the database path, stored and supported versions, and newer/branch-build explanation; it must not appear ready or defer the error until Add Todo or another application query. Keep the existing Project association and retry behaviour. Include actionable guidance to use the build that wrote the database or, for disposable pre-release data, reset that database after closing roundup; no automatic reset or deletion. Inspect the propagation from `crates/rupd/src/storage.rs`, `open`, through `crates/desktop/src/daemon.rs`, `start`, and `apps/desktop/src/state/projects.ts`, `createProjectsState`, to `apps/desktop/src/App.tsx`, `App`. This is an error-propagation policy, not a new UI or RPC contract; retain the existing surface and existing failure tests, with no new App/browser/process regression for this Issue.

Policy: this work adds refusal only. No repair, down-migration, import, schema adoption, automatic deletion, database rename or app-identifier change. `stored <= known` retains its existing migration/open behaviour. Do not rewrite applied SQL or weaken existing migration scenarios. Existing bounded repairs remain as specified; this work introduces none. No Message, Route, Held or Takeover change; M1–M10 remain unchanged.

### Implementation scope and checks

Policy: implementation covers the eight migration owners above, their existing open/error callers and in-process test modules. Existing Daemon/native error propagation may change only as needed to preserve this diagnostic. No App layout, styling, seam, contract or frozen loop changes. Use installed `rusqlite` and `rusqlite_migration`; no replacement migration engine or new store. Apply rule 9 if introducing shared migration machinery. Progress, audit findings and engineering questions belong on #5088, not a scenario Work table.

Required checks (existing acceptance on `origin/main`; policy):

1. `scenarios/project-store.md`, headings “N16 one live database holds all concerns” and “N17 old per-store databases never block startup”; `crates/rupd/src/storage_tests.rs`, `n16_all_stores_share_one_project_database` and `n17_old_store_files_never_block_the_open`, retain current persistence and ignored legacy files.
2. `scenarios/project-store.md`, heading “N20 current schemas need no pre-release adoption”, retains the disposable-data policy without adding repair.
3. `scenarios/merge-conflict-spots.md`, heading “N21 one file per migration”; `crates/rupd/src/storage.rs`, `migrations`, retains the frozen head and discovered added sequence.
4. `apps/desktop/src/app/u37_reopen.test.tsx`, `u37_a_failed_reopen_shows_the_message_in_ink_and_offers_reopen_again`, retains the existing Project failure and retry surface.

Principle observers (policy): P11's Gate asks whether a rejected operation loses unfinished input; refusal must not delete or reset data. Observe refusal's unchanged version/schema in the eight tests and inspect that no recovery path discards input. P12's Gate asks whether unavailable content hides its cause or substitutes another target; preserve the refused database's identity and diagnostic through N5088b's existing surface. No publication or editable surface is added.

Implementation verification (policy): run `just ready` and `cargo nextest run -p rupd -p agents -p todos -p pads -p messages -p provenance -p checkpoints -E 'test(n5088a_)'`, plus tests reached by edited files. Run `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`. Exit 0 passes; every other exit fails. For each failed command report one row containing command and exit code. Linux in-process tests and review of existing error propagation suffice; no Mac observation is required.

## Refuse databases whose schema diverges

**N5420a a database built by a different migration list is refused at open.** Work order: [#5420](https://github.com/roundup-app/roundup/issues/5420). Amended by N5467a–d (`scenarios/local-data-retirement.md`, #5467): only the current schema opens; historical prefixes are refused, not upgraded. For each live migration owner in N5088a's table, a current-version database whose application schema differs from the current schema returns an error identifying the database path, first differing object/column, stored/current versions and incompatible-build cause before application queries or writes (`n5420a_` tests below). No skipped-Pad exception remains. The reference is the current schema built from empty input, with the Project's existing build-time image; do not construct a historical reference. N5467a adds the folder and manual reset instruction; N5088a retains refusal of newer versions.

| Migration owner | In-process regression test to implement |
|---|---|
| Project: `crates/rupd/src/storage.rs`, `open` | `n5420a_project_refuses_a_divergent_database` |
| Agents: `crates/agents/src/schema.rs`, `open` | `n5420a_agents_refuses_a_divergent_database` |
| Todos: `crates/todos/src/schema.rs`, `open` | `n5420a_todos_refuses_a_divergent_database` |
| Pads: `crates/pads/src/schema.rs`, `open` | `n5420a_pads_refuses_a_divergent_database` |
| Messages: `crates/messages/src/schema.rs`, `open` | `n5420a_messages_refuses_a_divergent_database` |
| Digest: `crates/messages/src/digest_schema.rs`, `open` | `n5420a_digest_refuses_a_divergent_database` |
| Provenance: `crates/provenance/src/schema.rs`, `open` | `n5420a_provenance_refuses_a_divergent_database` |

Each test builds a temporary SQLite file at `stored = known` from the production list with one migration swapped for another (a different column added, so the schemas differ while `user_version` equals `known`), closes the setup connection and invokes the real storage open. Assert the error's path, first difference, both versions and newer/branch explanation; reopen through raw SQLite to assert `user_version` and the schema are unchanged. Derive `known` and the swap from the production sequence, not a copied count. No App, browser, real Daemon process or clock.

Policy: the moo.md Project database (`user_version` 52 against 52 known migrations, lacking `0037-todo-priority.sql`, the estimate removal, the Pad owner removal and the `project_import` tables) is the motivating case; the check reads only the opened file, so databases written before this change are refused the same way. No repair, down-migration, adoption or deletion of pre-release data. N5088a's refusal for `stored > known` and N5088b's propagation through the existing Daemon and App surface are unchanged and carry this diagnostic too. N5467a refuses `stored < known` without constructing a historical reference; the current open still compares against the embedded fresh image. The Checkpoints owner listed in #5088 has no crate on `origin/main`, so the implementation rechecks the inventory on its base, adds an equivalent test for any owner found and records the audited base SHA on its Issue.

Policy: Reuse (rule 9), decided for the implementation's `Reuse:` section. `refinery` (runner stores a checksum per applied migration and aborts on divergence) and `sqlx`'s migrator (checksums in `_sqlx_migrations`) both detect a divergent history only from a table they wrote; every database already on disk, moo.md's included, has none, and either replaces the installed `rusqlite_migration` owner of seven stores (sqlx also adds an async runtime and a second SQLite binding). `rusqlite_migration` 2.6 records only `user_version`. Comparing `sqlite_schema` with the schema the same list builds covers existing databases and needs no new dependency; the implementation records the release evidence and any candidate it finds that does so too.

Policy: rule 7. `just perf` shows no cold-start regression above 10% (`docs/perf.md`); the Project open's added work is bounded by one `sqlite_schema` read on each side.

Principle observers (policy): P11, refusal changes no data, shown by the unchanged `user_version` and schema asserted above. P12, the error names the refused file and the first difference, never a later SQL error or another target.

Implementation verification (policy): `just ready`, `cargo nextest run -p rupd -p agents -p todos -p pads -p messages -p provenance -E 'test(n5420a_)'` and the tests reached by edited files; `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`. Exit 0 passes; every other exit fails, one row per failed command with its exit code.
