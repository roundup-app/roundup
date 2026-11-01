# T3797a lint boundaries

`just lint-rust` runs the repo-wide tracked-file cap, ast-grep, typos and Ruff through `lint-repo`, then `cargo deny check` and machete. `just lint-web` runs madge and the existing web checks, with no repo-wide scan. See [command callers](../../docs/lint-callers.md) for the full inventory. `check.yml` runs the real-tool fixtures in the existing Chromium lane, whose result is required by `check`. The existing `pre` jobs invoke these recipes without a hook or workflow change.

```text
real tools → current inventory = exact recorded debt
                            debt ⊆ merge-base inventory
```

Run `pnpm --filter lint-boundaries test:boundaries` for the isolated observers. `scan.py <section> --record` prints observations; it cannot authorize an exception. Normal scans reject added identities, increased counts/ceilings and stale entries. Remove repaired entries; lower an oversized file's ceiling to its actual newline count. Every remaining exception is printed, including its reason. Exit 0 means clean or exact debt, 1 means a policy violation, and 2 means an incomplete scan, tool/input/configuration failure. Native statuses are interpreted only with complete structured diagnostics.

`debt.json` records full matched source, occurrence ordinal and diagnostic detail; location is informational, so an unrelated line insertion does not create an exception. Duplicate crates use exact name/version pairs; advisories use exact RustSec id/name/version triples. There is no wildcard, word, file or subtree suppression. typos excludes only its generated exception inventory, which contains the rejected spellings themselves, and otherwise uses normal binary/ignore behavior. AST scans use tracked Rust/TS/TSX files, including tests. Git attributes, binary detection, paths, lockfile names and first-five-line headers implement the size hook's existing `generated()` predicate against the current tree. The hook remains untouched.

The first rollout independently scans the unchanged merge base when that revision has no inventory. Subsequent scans read the merge base's inventory directly. A move, tool update or re-record cannot add an identity. The cycle checker has no exemptions: its final inventory is empty. It includes type edges, checks parser diagnostics, and treats unresolved local source imports as scan failures.

## Initial evidence

Implementation base: `dc5a41f1e` (all-platform graph, all Cargo features).

| Inventory | Exact entries |
| --- | ---: |
| Oversized tracked files, every extension | 30 |
| Sleep-loop calls (DOM cloning/style overrides: zero) | 146 |
| typos diagnostics (binary notices excluded) | 164 |
| Ruff E4,E7,E9,F in frozen loop Python | 8 |
| Duplicate crate versions across 48 crate names | 112 |
| RustSec advisory/crate/version triples | 3 |
| Type-containing cycles before / after | 5 / 0 |

Each first-run recipe rechecks this inventory against the actual unmodified base; this table is descriptive, not trusted input. On b2d337467, three cached samples including pnpm startup on this shared runner: madge 26.264/23.261/24.903 s, exit 1 with all five cycles; fallow 1.908/2.247/2.039 s, exit 0 with none. These samples ran alongside the related App suite; they establish type-edge coverage, not isolated performance. The extra TypeScript parse check ensures an invalid source never looks acyclic.

The five chains in the scenario all disappear by typing the Rail draft adapter from its existing `draftStorage` holder instead of the connected Project composition. Callers and runtime expressions stay the same.

## SPDX and advisory policy

`deny.toml` allows MIT, Apache-2.0 (including LLVM-exception), BSD-2-Clause, BSD-3-Clause, ISC, Unicode-3.0, Zlib, CC0-1.0, MPL-2.0, BSL-1.0, Unlicense and CDLA-Permissive-2.0. These cover permissive dependencies, public-domain grants, MPL's file-level terms, compiler support and the WebPKI root certificate data. Other expressions and unlicensed crates fail. A licence is accepted only when its SPDX expression satisfies this list; neither licence nor advisory checking is disabled.

The initial advisory exceptions are `RUSTSEC-2024-0429` / glib 0.18.5 (GTK through Tauri), `RUSTSEC-2024-0370` / proc-macro-error 1.0.4 (GTK macros through Tauri), and `RUSTSEC-2026-0386` / tokio 1.53.1 (workspace async runtime). Exact chains are in the inventory. Retaining these versions establishes the existing debt without an unrelated runtime update. A different version or advisory fails; fixing an advisory requires removing its stale entry. cargo-deny emits its native diagnostics without `skip`, `skip-tree` or advisory `ignore`; the inventory adapter normalizes only exact recorded identities and keeps both unmaintained and unsound advisory scopes at `all`.

## Reuse

Installed fallow remains responsible for dead code and duplicates. Its architecture command misses type-only imports. Installed TypeScript supplies parsing, but no cycle gate. [Madge 8.0.0](https://github.com/pahen/madge/releases/tag/v8.0.0) supplies the graph and cycle algorithm; its separate workspace pins TypeScript 5.9.3 because the App's TypeScript 7 package has no compiler JS interface. The App's compiler and the existing security overrides remain intact. [Dependency-cruiser 18.7.0](https://github.com/sverweij/dependency-cruiser/releases) is maintained and capable, but its published package is 1,048,461 unpacked bytes versus madge 8's 105,058; the narrower cycle tool was selected. No graph algorithm is handwritten.

[ast-grep 0.51.0](https://github.com/ast-grep/ast-grep/releases/tag/0.51.0) (2026-10-15) supplies Rust/TS parsers and matching. Existing oxlint and stylelint cannot inspect Rust loops; stylelint cannot inspect TS literals. Installed stylelint already brings [mdn-data](https://github.com/mdn/data/releases); pinning 2.27.1 directly provides maintained CSS property names, so ordinary prose is not mistaken for a declaration. Fallow's `mdn-data` entry documents consumption through Python, which its JS import graph cannot see. This is a used tool dependency, not an orphan.

[cargo-deny 0.20.2](https://github.com/EmbarkStudios/cargo-deny/releases/tag/0.20.2) (2026-07-09), [Ruff 0.17.2](https://github.com/astral-sh/ruff/releases/tag/0.17.2) (2026-10-22), and [typos 1.51.1](https://github.com/crate-ci/typos/releases/tag/v1.51.1) (2026-10-06) provide their respective analyses. `releases.json` pins release URLs and SHA-256 checksums for Linux/macOS on both architectures. Recipe setup installs into ignored local directories, without global installs.

For the inventory adapter, [reviewdog](https://github.com/reviewdog/reviewdog/releases) and [diff-cover/diff-quality](https://github.com/Bachmann1234/diff_cover/releases) were considered. reviewdog v0.21.2 shipped 2026-09-18 and diff-cover v10.6.0 shipped 2026-09-22. Both are maintained diff-based reporters; neither enforces stale exact-occurrence removal, ceiling shrinkage, or exception-file subset checks against a merge base. Tool-native file/rule/word ignores also lack those capabilities. Python's standard JSON/subprocess/temporary-directory facilities and Git's tracking/attributes/worktree plumbing implement only that missing ratchet, without a second parser or dead-code checker.
