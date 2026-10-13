# Pinned Claude plugins (Q11)

Source: https://github.com/saadshahd/moo.md/tree/595eda0e3b477d1af1daad82f395073d4f912c8d

hope 13.1.0, hunch 0.9.4, hold 0.0.9. `moo.json.gz` contains every tracked file
under those three directories (157), plus the upstream MIT LICENSE. Tests are
retained too. Every entry preserves its source UTF-8 bytes and Git executable
mode, and records its Git blob and SHA-256. `inventory.tsv` exposes those records
without decompressing the archive. `moo.sha256` pins the complete archive.

Reproduce without trusting working-tree edits:

```sh
python3 crates/agents/assets/plugins/pack.py /path/to/moo.md-checkout
```

The script reads Git objects from the pinned commit, never HEAD. JSON uses sorted
Git paths and compact UTF-8 encoding; gzip uses level 9 and mtime 0 (Python 3.12.3 /
zlib 1.3). Reproduction must leave all three generated files unchanged.
Neither this script nor Git nor a network fetch is used during delivery.

```text
materialize(roundup Project data)
  verify embedded archive and each source asset
  write private directory, verify complete inventory
  Plugins.runtime(selected Claude executable)       # once at runtime selection
    Claude plugin test: actual TypeScript loader
    import claude-code.update + both registration functions and local modules
  Runtime.command(Plugins)                          # each launch
    recheck every asset; configure all three --plugin-dir paths and function flag
```

Keep Plugins alive for the Agent's lifetime; dropping it deletes its private
directory. Supply roundup's Project data directory, never the Project/worktree.
No Project path enters the interface. Delivery does not read or modify user
settings, CLAUDE.md or .claude. A separate probe directory is removed after probing. It holds byte-identical runtime
copies and one roundup test; upstream test files remain in the delivered bundle but
are excluded from this focused compatibility probe.
A corrupt, missing, additional or symlinked asset rejects the entire bundle.

`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is mandatory. The vendor runtime supplies
`claude-code` and `claude-code/testing`; these must not be replaced by an npm stub.
hope's slop.tsx imports update and its judge.sh executes sh/git/claude (the
judgement itself uses the user's logged-in Claude). hunch's tend.tsx imports
band.tsx, gate.tsx and memory.tsx; memory.tsx references band.tsx. All are pinned.
No npm install or startup dependency fetch is required. Future runtime versions
must pass the loader probe; a zero exit without the named passing test is rejected.

#1521 must consume Runtime.command, keep the bundle alive, cache the verified
runtime outside cold start, and own launch/resume/clear wiring and loaded-plugin
inventories for both roles. This prerequisite changes no Agent launch or Brief.
The probe proves import and registration, not model behaviour or a loaded-Agent
inventory. It needs no model request, login, personal profile or user Project.

## Recorded observer

Linux, Claude Code 2.1.296, 2026-10-13:

```sh
ROUNDUP_CLAUDE=/home/runner/.local/bin/claude \
  cargo test -p agents --test plugins q11_real -- --ignored --nocapture
```

Pass: actual vendor TypeScript loader imported pinned hope/slop.tsx (including
`update`), pinned hunch/tend.tsx and its three local modules, and registered the
required events. The returned command has exactly three plugin-directory pairs
and function hooks enabled. Unsupported/no-op runtime tests fail actionably.

Full upstream hope tests on this runtime: 30 pass, 1 fails because its test's
prompt.fill hook returns no `{ isFilled }`. The pinned files are unchanged. This
is not a loader failure or a claim that upstream behaviour tests pass; the Q11
probe isolates import/registration compatibility and makes no model request.

Offline checks: all 158 source bytes compare equal to their pinned Git objects;
regeneration produces identical archive, digest and inventory. Q11's six ordinary
packaging tests pass; cold materialization measured 106.8 ms in the debug observer,
below 300 ms. The real-runtime observer is explicit because CI need not install
Claude. Q1/Q6's existing body/checksum tests remain untouched.
