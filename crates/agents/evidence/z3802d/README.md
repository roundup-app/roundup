# Z3802d: drop gix 0.90.0

The installed Git 2.55.0 finds an existing `refs/heads/main` in a reftable
repository; gix returns `Ok(None)`. Replacing `Git::reference` would therefore
change valid-reference semantics. git2 0.21.0 rejects the same repository's
`extensions.refstorage`. Keep the existing executable reader. This replaces the
earlier Issue comment's shell-wrapper/deadline argument: bypassing an injected
shell wrapper alone does not establish a library capability failure.

Production reference: `066f4cfd45196c5e7f67c1b0b94ce962c4f29cf9`.
The probe's source, pinned standalone manifest and complete dependency lock are
retained here, outside workspace membership and production dependency graphs.
`session.json` records the observer revision, binary/lock hashes, host, boot,
Worktrees, toolchain, release settings, build cost and timing summary.

## Reproduce

From the repository root:

```sh
bash crates/agents/evidence/z3802d/reproduce.sh
```

Observed exact command (reuses the scratch build cache):

```sh
CARGO_TARGET_DIR=/tmp/z3802d-probe/target bash crates/agents/evidence/z3802d/reproduce.sh
```

The wrapper exits 0 after asserting the expected mismatch. Inside it,
`z3802d-probe read <fresh-reftable-repository> refs/heads/main` exits **1**:

| Reader | Result |
|---|---|
| shell | `Ok(Some("3f9088f9e568ad436e1c636c86b4c535e87030ad"))` |
| gix | `Ok(None)` |
| git2 | unsupported `extensions.refstorage` error |

The fixture uses real isolated repositories, `git init --ref-format=reftable`,
a deterministic empty commit, ordinary refs and a linked Worktree. No injected
failure or Agent process is involved. The failed criterion is equal valid-ref
results, not a performance threshold or unavailable hardware.

Primary sources: [gix 0.90.0 reference API](https://docs.rs/gix/0.90.0/gix/struct.Repository.html#method.try_find_reference),
[gix-ref 0.69.1 file backend decoder](https://docs.rs/gix-ref/0.69.1/src/gix_ref/store/file/loose/reference/decode.rs.html)
and [Git reference storage formats](https://git-scm.com/docs/git-init#Documentation/git-init.txt---ref-formatltformatgt).
The latter decoder explicitly recognizes an unsupported reftable marker; the
observed `None` is from looking up the branch itself, not reading that marker.

## Measurements

`repeat-run.log` retains all raw output and durations in nanoseconds. Eleven
rounds rotate which reader goes first, each opening the same repository afresh.
Every round reads packed `main`, loose `loose`, missing and provisioning refs in
both the main and linked Worktrees: 88 samples per reader. Fixture construction,
compilation and the independent expected-result read are outside each timer.
The shell observer mirrors the unbounded production reader's executable commands
and missing-ref fallback; it is not a replacement for the bounded caller probe.

| Reader | Median ns | Min–max ns |
|---|---:|---:|
| shell git | 4,432,638 | 1,832,987–10,505,652 |
| gix | 350,191.5 | 269,756–473,247 |
| git2 | 298,259 | 210,134–514,184 |

One host, boot, process and release binary supplied all three readers in the
session. Starting/ending load was 6.05/6.21 on four CPUs, below the unchanged
Linux perf load ceiling of 2 per CPU. The first run overlapped lint compilation;
`busy-run.json` retains its entire raw output as a JSON string, exit 0 and busy
classification. The repeat establishes no full production perf pass.

All 264 ordinary lookup outcomes match. SHA-256 snapshots of **every fixture
file**, before and after both the timing and reftable probes, compare equal
(exit 0), including indexes, loose/packed/reftable refs, logs and Worktree
registration. Thus the read probes change no repository contents or status.

Nonblank, noncomment counts, including function signatures/braces, after rustfmt:

| Counted file/function | Lines |
|---|---:|
| `crates/agents/src/worktree.rs`, `Git::reference` | 24 |
| this directory's `probe.rs`, `gix_read` | 13 |

These exclude dependency/generated/test code symmetrically. The spike has no new
read helper/adapter. Thirteen is the experimental reader's size, not a claim that
a complete deadline/serialization-preserving production replacement exists.
The semantic failure ends adoption regardless of its speed or apparent size.

The combined gix/git2 release observer is 2,646,736 bytes; its first build took
127 s including registry resolution/downloads. These are observer costs, not
marginal roundup binary/build costs. Production before/after are identical:
no dependency, caller, mutation, permission, contract, stored data or budget
changes. `just perf` was not run: no candidate is retained and no performance
saving or rule-7 pass is claimed. Tests named in Z3802d remain planned adoption
tests; the retained disposable probe is policy evidence, not a new normal test
suite or dead production dependency.

## Validation and rules

`pnpm install`, `just lint-web` and `just lint-rust` exited 0. The reached observer
command above exited 0, retaining the raw semantic failure status 1. No existing
test file was changed. P2 isolation is recorded by `git worktree list` in the
session record; only the run's own Worktree and scratch repositories were used.
P4/P9/P11/P14 have no changed production path.

Release/download observations from the primary crates.io APIs are retained in
`gix-registry.json` and `git2-registry.json`, dated 2026-10-25. Both are maintained;
each is rejected here for the demonstrated reftable capability failure. Workspace
and Agents Cargo dependencies/patches, pnpm dependencies and the existing platform
Git reader were inspected first. No new library or platform workaround is kept.
