# Z3802f cargo-mutants PR-diff probe

Work order: #4059; specification: #3802. Probe inputs are from merged Rust PR
[#4028](https://github.com/roundup-app/roundup/pull/4028), not a manufactured workload.
The exact PR head is `ef1c1cea1876b662947bd4a6725f347f2db1263b`; the base is
`d74415ac42b3783937b6d707512d1ee15948dff5`. `pr-4028.diff` is their
merge-base-to-head, zero-context diff. Cargo-mutants 27.1.0 selects 67 mutants.

`probe.command` is a retained experiment command, not an installed CI adapter.
Run in an isolated checkout of the PR head, with Rust 1.99.0, cargo-nextest
0.9.149, and the repository's native build dependencies already installed:

```bash
git diff --no-ext-diff --no-renames --unified=0 \
  "$(git merge-base d74415ac42b3783937b6d707512d1ee15948dff5 ef1c1cea1876b662947bd4a6725f347f2db1263b)" \
  ef1c1cea1876b662947bd4a6725f347f2db1263b > "$evidence/pr-4028.diff"
timeout --signal=TERM --kill-after=5s 600s bash "$evidence/probe.command" "$evidence"
```

The command downloads the pinned upstream Linux binary and runs supported
`--in-diff`, `--in-place`, and `--test-tool nextest` options. It runs tests in
mutated packages, rather than the entire workspace. No shard, mutant cap,
regex, skipped baseline or weakened test selection is used. Tool setup and
all builds count toward the deadline; successful publication would also
have to fit below 600 seconds. A deadline is a drop, never a keep result.

Host, toolchain, exact diff, registry observations, timestamps and raw output
are retained beside this file. The probe uses a fresh target directory and
the CI runner's existing Cargo registry/toolchain. It does not share the
Builder's target directory. The parent CI run is recorded in `metadata.json`.

## Candidate comparison

Installed `Cargo.toml`, Cargo patches, `package.json`, `.github/actions/setup/action.yml`
and `check.yml` were inspected: nextest, Cargo tests and affected-test lanes
already exist; no mutation tool or diff-mutation adapter exists. Git supplies
the merge base and diff. Use the tool's supported selection/reporting rather
than adding a parser or selection wrapper.

`registry.json` records dated crates.io API observations, versions, releases
and download counts for both maintained candidates.

- [cargo-mutants](https://crates.io/crates/cargo-mutants) 27.1.0, released
  2026-06-02: native [diff selection](https://mutants.rs/in-diff.html) and
  [separate exit outcomes](https://mutants.rs/exit-codes.html). Its
  [CI documentation](https://mutants.rs/ci.html) recommends prebuilt binaries
  and `--in-place`; this probe uses both.
- [cargo-llvm-cov](https://crates.io/crates/cargo-llvm-cov) 0.9.1, released
  2026-09-06: its [documented reports](https://github.com/taiki-e/cargo-llvm-cov/tree/v0.9.1)
  measure line/region/branch coverage, not changed programs surviving tests.
  It lacks mutant generation and caught/missed/unviable/timeout classification,
  so it cannot supply this scenario's detection capability.
