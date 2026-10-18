# worktrunk v0.80.0 release observer

Captured on Linux x86_64 on 2026-10-18, using the unmodified release executable:

- Version stdout: `wt v0.80.0\n`.
- [Release](https://github.com/max-sixty/worktrunk/releases/tag/v0.80.0), published 2026-09-27; source commit `b49ca7eea9b03145791a5b94eccaf9c59412ed37`.
- Archive: `worktrunk-x86_64-unknown-linux-musl.tar.xz`.
- SHA-256: `532ce3ed5eecb1be274c925b5887f61671e2434a4ca2561b9a8ac9379dbba199`.

`local.json` and `full.json` are stdout bytes from a real repository at
`/tmp/wt-fixture`, with `main`, the tracked file `tracked` containing
`original\n`, and a linked `feature` worktree at `/tmp/wt-fixture-feature`.
No remote was configured. Exact argv (executable omitted):

```text
list --format=json --config /dev/null --config-set list.summary=false --config-set list.json-schema=2
list --format=json --config /dev/null --config-set list.summary=false --config-set list.json-schema=2 --full
```

Both ran with cwd `/tmp/wt-fixture`. Collector environment overrides:
`WORKTRUNK_CONFIG_PATH=/dev/null`, `WORKTRUNK_SYSTEM_CONFIG_PATH=/dev/null`,
`WORKTRUNK_PROJECT_CONFIG_PATH=/dev/null`, `WORKTRUNK_VERBOSE=0`,
`GIT_OPTIONAL_LOCKS=0`, `GIT_CONFIG_COUNT=2`,
`GIT_CONFIG_KEY_0=core.fsmonitor`, `GIT_CONFIG_VALUE_0=false`,
`GIT_CONFIG_KEY_1=core.hooksPath`, `GIT_CONFIG_VALUE_1=/dev/null`.
The collector additionally removes inherited `WORKTRUNK_*` overrides and disables
interactive git/credential/gh prompts.

`full-network.json` is also unmodified real wt stdout, with the same full argv
and cwd. The fixture then added remote
`https://github.com/fixture/collector.git`, set `origin/main` and
`origin/feature` to the fixture commit and `origin/HEAD` to `origin/main`.
A temporary directory prepended to PATH contained `gh.py` installed as
executable `gh`; it supplies deterministic forge transport without login or
network. This pins the release's actual translation of a passing check and a
changes-requested review into separate `checks` and `pr` fields; it does not
claim a live GitHub observation. The other two recordings use the ordinary PATH.

Release sources inspected:

- [`json_v2.rs`](https://github.com/max-sixty/worktrunk/blob/v0.80.0/src/commands/list/json_v2.rs): envelope `schema: 2`; `pr_and_checks` separates review from check results. Missing checks/PR and null values do not imply success. Only positive PR numbers enter roundup.
- [`collect/mod.rs`](https://github.com/max-sixty/worktrunk/blob/v0.80.0/src/commands/list/collect/mod.rs): JSON collects all built-in facts; column selection cannot disable tasks. Summary needs both an enabled summary setting and a generation command.
- [`custom_columns.rs`](https://github.com/max-sixty/worktrunk/blob/v0.80.0/src/commands/list/custom_columns.rs) and [`sections.rs`](https://github.com/max-sixty/worktrunk/blob/v0.80.0/src/config/user/sections.rs): this release's custom columns render templates, not executable commands. All custom configuration is nevertheless excluded; a configured `command` extra must never become an execution path.
- [`user/path.rs`](https://github.com/max-sixty/worktrunk/blob/v0.80.0/src/config/user/path.rs), [`user/mod.rs`](https://github.com/max-sixty/worktrunk/blob/v0.80.0/src/config/user/mod.rs), and [`hooks.rs`](https://github.com/max-sixty/worktrunk/blob/v0.80.0/src/commands/hooks.rs): user/system/project configuration paths and environment overrides. `list` has no hook execution flag or hook execution path; do not pass unsupported `--no-hooks`.
- [`integration.rs`](https://github.com/max-sixty/worktrunk/blob/v0.80.0/src/git/repository/integration.rs): merge-tree can invoke configured git merge drivers. The collector refuses enrichment in repositories with those drivers, retaining local git usability. Git fsmonitor hooks are disabled in wt's environment.

The real-executable sentinel observer is intentionally separate from hermetic
CI tests. After extracting the pinned archive to an isolated test directory:

```sh
ROUNDUP_TEST_WT=/absolute/path/to/wt cargo test -p agents --lib \
  worktrunk::tests::u2556b_collection_cannot_run_configured_commands \
  -- --ignored --exact --nocapture
```

It passes with hostile user/system/project config and environment settings in a
child test process; both collection modes run without sentinel files, changed
refs or changed tracked-file bytes. Hermetic tests separately prove merge-driver
refusal, process timeout, cancellation/reaping and malformed/oversized output.

Reuse: worktrunk is selected for its existing combined git/forge collector.
[gitoxide](https://github.com/GitoxideLabs/gitoxide/releases/tag/gix-utils-v0.5.1)
remains maintained (release 2026-10-11), but supplies no combined worktrunk
CI/PR schema: replacing wt with it would require the new forge client this Issue
excludes. Existing agents `Git::registered_worktrees`, Tokio, tempfile and rustix
supply git ownership, background work, output files and group termination.
Neither candidate supplies roundup's Rail identity or Project admission/cache
policy; the crate-private adapter owns those.
