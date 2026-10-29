# Storage migration order

Specification for #4522. Terms: Project, Project data, Pad, Daemon (`GLOSSARY.md`). This specifies one bounded repair and a CI guard; it adds no RPC, App seam, migration engine or general pre-release adoption promise (policy).

**B4522 migration additions never move an applied position.**

## Repair

Given a Project database at any earlier valid version of the production sequence, when the normal storage owner opens it with the repair, then `pad_deletions` exists and supports the current Pad deletion contract (`b4522_earlier_project_versions_support_pad_deletion`, parameterized over every prefix from zero through the implementation base's latest version). Build actual schemas by applying those prefixes; do not label a latest schema with an earlier `user_version`. Include the frozen ten-entry head and every added file, not filename numbers interpreted as SQLite versions.

Given the observed drift at `user_version=44`, with `todo_deletions` and `rail_deletions` present but the Pad-deletion migration absent, when normal Project startup runs, then Pad creation, deletion, retained-operation lookup and restoration succeed through the real Daemon's existing Pad RPCs, including after reopening (`b4522_skipped_pad_migration_recovers_on_open`). The fixture must omit that migration's effects, including its trigger changes, rather than merely drop its table from a latest schema. Assert the restored Pad retains its identity and text and its original source incarnation; revocation of a publication existing before deletion remains effective after restore. This is one repair outcome, observed through current callers, not a new deletion contract.

Given a database where Pad deletion already works and a retained deletion exists, when the repair runs and the Project reopens twice, then that retained operation remains readable and restorable, without duplicate records or changed identity (`b4522_existing_pad_deletion_survives_repair`).

Policy: append the repair strictly after the implementation base's last Project migration. Preserve existing migration paths, bytes and positions; never rename applied files to remove duplicate prefixes. Restore all missing effects of the skipped Pad migration, including source-restoration and publication-revocation triggers, while accepting already-present objects. Keep the installed `rusqlite_migration` owner and the build-time fresh image. The existing fresh-image/schema comparison remains the observer for fresh creation.

Policy: this explicitly adds a narrow exception to N20's absence of a historical-open promise. It covers production-sequence prefixes and the named skipped-Pad case, not arbitrary schema drift, reconstruction of other historical collisions, import of old per-store data or a general upgrade framework. Pre-release data remains disposable.

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

Applicable P12 gate (policy): can the repair substitute a published Pad incarnation or override explicit revocation? Observer: `b4522_skipped_pad_migration_recovers_on_open` verifies exact restored identity and continued revocation of the old publication through existing Daemon calls.

Required checks (policy; existing anchors on main):

1. Preserve one production sequence and normal opening: `crates/rupd/src/storage.rs`, `migrations`, `apply` and `open`; `crates/rupd/build.rs`, `main` and `fresh_image`. The ten-entry head remains fixed, and fresh-image creation applies the appended repair too.
2. Preserve fresh-image equivalence: `crates/rupd/src/storage_tests.rs`, `r3696c_a_fresh_project_db_equals_the_migrated_one_with_its_own_identity`.
3. Preserve current store operations: `crates/rupd/tests/store_migrations.rs`, `n20_current_store_opens`; `scenarios/project-store.md`, heading “N20 current schemas need no pre-release adoption”, subject only to the bounded exception above.
4. Preserve Pad restoration and revocation: `crates/rupd/migrations/project/0026-pad-deletions.sql`, the `pad_source_created` and `pad_publications_revoked` trigger definitions; `crates/pads/migrations/004/up.sql`, the standalone deletion schema. Do not repair only the missing table.
5. Preserve migration discovery and clean text merges: `scenarios/merge-conflict-spots.md`, heading “N21 one file per migration”; `crates/rupd/src/storage_tests.rs`, `n21_two_migrations_added_on_two_branches_merge_cleanly` and `n21_a_migration_file_runs_after_the_head_in_name_order`. A clean Git merge does not authorize duplicate-prefix additions in CI; an unmerged addition conflicting with newly landed main work must receive a new appended number before merge.

Policy: Linux Rust tests observe the repair; the filename guard's local fixtures observe CI refusal. No UI, rendered capture or Mac-only observation is required. The implementation records the audited base SHA, all discovered migration directories and duplicate groups on its Issue. Run `just ready`, affected Rust tests and the guard fixtures; report one row per failed command with its exit code. Exit 0 passes, every other exit fails. Specification validation runs `loop/rules.sh vocab` and `loop/rules.sh scenario-ids`; both must exit 0. No scenario Work table holds progress or engineering questions.
