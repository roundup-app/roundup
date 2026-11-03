# U5741 Provenance query validation

Builder: `builder-41703528722`. Audited main: `7ae759f2bc7f8e8e58a02a11f88488480364db41`. Documentation only: [provenance.md](provenance.md) assesses two queries and preserves their storage/consumer boundaries. No product, contract, scenario, test or frozen-loop change. No local `just check`.

| Command / observer | Exit | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Installed worktree dependencies before push. |
| `cargo build -p rup -p rupd` | 0 | Current binaries rebuilt; their hashes are archived. |
| `python3 /tmp/u5741-provenance-observer.py` | 0 | Actual descriptions, both leaf help paths, actual stdio MCP lists (86 Agent / 94 Door tools), exact schemas and four live CLI queries against an isolated real Daemon. Archived replay includes fixture calls and cleanup. |
| `python3 /tmp/u5741-provenance-integrity.py` | 0 | 28 pinned source archives match audited main and checkout; both exact schema/offer mappings, query results, no extra Touch, dated direction, vendor evidence and file limits verify. Replay is archived in the catalogue. |
| `cargo nextest run -p provenance -E 'test(history_lists_touches_of_one_item_oldest_first) \| test(touched_lists_everything_one_actor_did)'` | 0 | Both existing query behavior tests pass; four unrelated tests skipped. No tests added or edited. |
| `python3 loop/orders.py check /tmp/u5741-issue-body.md` | 0 | Expanded documentation scope validated before updating #5758. |
| `git diff --check` | 0 | No whitespace errors. |

The catalogue preserves the original command arguments, stdout/stderr, return codes, source hashes and lossless JSON archives. CLI fixture reads are not a vendor conversation, owner usage measurement, durability/reopen observer or successful MCP tool-call claim. The MCP lists are actual runtime replies for a synthetic non-Door identity and an unstarted Workstream's real Door id. No vendor Agent or App starts. Every write is to the temporary isolated Project data; the observer terminates only its own processes. Daemon shutdown -15 is its intentional TERM, not an observer failure.

Against the earlier public-census revision, only `docs/wireframes.md` changes among the 28 inspected files; its current content is archived and inspected. Earlier App renders retain their original dates and commits. The query commands' textual results support this slice; no new App rendering, native behavior or visible product change is claimed. Broader App/endpoint/equivalence and current whole-inventory reconciliation remain required before the single owner request. No partial request, owner answer or deletion.

## Failed exploratory commands

Each absent guessed source path was replaced by the actual source discovered with `rg --files`/registration search. None establishes product absence or a passing observer.

| Command / observer | Exit | Failure and disposition |
| --- | ---: | --- |
| Initial `test -d .codegraph` probe | 1 | No index; ordinary repository discovery used. The surrounding shell continued successfully. |
| `ls target/debug/rup` | 2 | Default target path absent; actual `CARGO_TARGET_DIR` is `/home/boxd/cargo-target`. Rebuilt there. |
| `cat crates/rupd/src/provenance.rs` | 1 | Guessed file absent; handlers are in `builtin.rs`, storage in `crates/provenance/src/store.rs`. |
| `cat crates/contracts/src/methods/provenance.rs` | 1 | Guessed file absent; declarations and params are in `declarations.rs` and `common.rs`. |
| `rg` over guessed `scenarios/provenance.md` and `scenarios/links.md` | 2 | Paths absent; actual owning clauses found across UI, daemon, MCP, Message and Todo scenarios. |
| `cat scenarios/provenance.md` | 1 | No dedicated scenario file; actual owning files read and archived. |
| `rg` over guessed `scenarios/actors.md` and `scenarios/authority.md` | 2 | Paths absent; current routing, selectors and guard source inspected. |
| `rg` over guessed `crates/rupd/src/authority*` and `permissions*` | 2 | Globs unmatched; actual route/guard sources inspected. |
| `rg` over guessed `scenarios/overview.md` | 2 | Path absent; no Overview absence or deletion claim follows. Overview stays excluded. |
| `cat crates/rupd/src/guard.rs` | 1 | Singular path absent; `guards.rs` is the actual file. |
| `rg` over guessed `scenarios/architecture.md` | 2 | Path absent; declarations and actual owning scenarios supplied acceptance sources. |
| `rg` over guessed `crates/rupd/src/authorization.rs` | 2 | Path absent; actual source is `guards.rs`, plus production route/selector dispatch. |
| `python3 tools/lint/scan.py file-size` | 2 | Invalid section name; corrected `python3 tools/lint/scan.py size` passes (0), retaining the existing baseline debt. |

The initial probes were exploratory, not scenario observers. No runtime query or named behavior test failed. The two primary vendor pages opened successfully; no substitute source or inferred vendor measurement was used.

Self-review strengthened the runtime fixture with a second Todo: item history excludes it while Actor history includes it. This corrects the initial report’s unsupported statement about a Workstream appearing under the user. Replayed runtime and integrity observers pass (0); the archived source revision stays the original main commit, independent of subsequent documentation commits.

Merged `origin/main` at `eb958ff1fee390218a6639d114dc05eb62e85170` without conflicts; its only change since the audited revision adds the commit-attribution specification. All 28 inspected source archives still match the checkout; the integrity observer and merge-loss pass (0). This does not promote historical App evidence or claim the whole-App inventory is current. Standalone spelling, size, vocabulary, scenario ids and whitespace checks pass (0).

Final `just ready` passes (0): all 193 lint fixtures, package type checks, repository/Rust lints, migration guard, `ALL PROOFS CHECK` and N7. The main merge completed during this run before its repository/Rust checks; the only incoming file is the unrelated specification recorded above, and every inspected implementation stays identical. The two named store tests, strengthened live fixture, source/offer integrity, spelling, size, vocabulary, scenario ids, merge-loss and whitespace checks pass (0). Independent required CI/review judge the pushed head; no successful future merge is claimed here.
