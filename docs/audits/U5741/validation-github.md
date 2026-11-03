# U5741 GitHub tool evidence validation

Builder: `builder-41680665676`. Audited main: `f7471659e2d3669818163a538cdfc2a7dc20b946`. Scope is documentary only; [github-tools.md](github-tools.md) records GH01–GH05. No product, contract, scenario or test changed. No local `just check`.

`pnpm install --frozen-lockfile` and `cargo build -p rup -p rupd` pass (0). The corrected archived observer passes (0): current descriptions and five leaf help paths, real stdio MCP lists (86 Agent tools, 94 Door tools), exact schemas and two live GitHub reads through the real isolated Daemon. An unstarted Workstream supplies the Door lookup; no vendor Agent or App starts, and no GitHub write probe runs. The observer closes its own MCP processes and terminates its own Daemon; the recorded Daemon shutdown is -15 (intentional TERM), not an unexpected failure.

The source/offer observer verifies 18 pinned source archives byte-for-byte against the audited commit and checkout; all 18 also equal the earlier public census revision. Compressed role/read/direction/search records verify decoded SHA-256. Five public mappings, versioned vendor help, source-search classifications and catalogue limits verify. The complete integrity observer and exact replay are archived in `catalogues/github-source.json`; current public evidence does not promote historical App images to this revision.

`cargo nextest run -p rupd -E 'test(/a5168/)'` passes (0): all 16 existing GitHub behavior tests; 418 unrelated tests skipped. This proves the fake-gh write/read/repeat/refusal/error/environment behavior, not a live remote write.

## Failed commands and limits

| Command / observer | Exit | Failure and disposition |
| --- | ---: | --- |
| Initial optional `ls -d .codegraph` probe | 2 | No index directory; ordinary repository discovery used. |
| `cat crates/rupd/src/rpc/github.rs` | 1 | Guessed path absent; read actual `crates/rupd/src/github.rs`. |
| `rg` on guessed `crates/agents/src/claude_code/door.md` and `agent.md` | 2 | Paths absent; source is `brief.rs`, with fixtures under `tests/fixtures/brief`. |
| `rg -n pr-set-body crates/rup/src/cli/help.rs` | 1 | No literal in generic help builder; actual leaf help and contract declaration establish spelling and positional body. |
| First `python3 /tmp/u5741-github-observer.py` | 1; child 2 | `rup github pr-get` requires an Agent id; supplied the isolated actual Door id on corrected PR and Issue reads. No failed read counted as success. |
| First `cargo nextest run -p rupd -E 'test(/^a5168/)'` | 4 | Anchored filter matched no fully qualified test names (zero executed, not a pass); corrected filter matches the scenario id within the module path. |
| First `python3 tools/lint/scan.py typos` | 2 | Required tool setup missing in new worktree; ran `python3 tools/lint/setup.py web` before repeating. |

No new rendered opening is claimed: the five operations have no direct production App call site in the recorded search; its matches are library URLs, not RPC consumers. The existing changed-work/PR links remain independently inventoried. Write semantics are inspected in source and the existing named behavior observers; help does not establish remote mutation success. No native or real-conversation observation, owner usage assumption, partial candidate request or deletion is claimed. Every remaining per-method/App/equivalence gap and final current whole-App reconciliation stays open on #5758.

Final `just ready`: exit 0, including migration guard, all 193 lint fixtures, package type checks, repository/Rust lints, `ALL PROOFS CHECK` and N7. Standalone spelling (after setup), archive/source/offer integrity, file-size cap, vocabulary, scenario ids, merge-loss and whitespace checks pass (0). Self-review corrected the report's body argument to match actual positional CLI help. No upstream merge was needed; no inspected source changed during validation. Independent required CI and review judge the pushed head.

## CI timeout repair — builder-41686294061

| Command / observer | Exit / result | Evidence and disposition |
| --- | --- | --- |
| `pre` run `41683567869`, lint job `126083258429` | Cancelled; aggregate `pre` exits 1 | The 15-minute job limit expired. Fetch ran from 17:22:47 to 17:30:21 UTC; setup ended at 17:36:42. Lints ran about 43 seconds before cancellation at 17:37:26, during dependency compilation. No lint diagnostic established a source defect; this run is not a pass. |

Merged `origin/main` at `f364d79c84ffc01f8fd10a227b2f544d1f4d53f7` without conflicts. The archived integrity observer passes (0): all 18 pinned sources still match the checkout, with five mappings, both recorded roles, two recorded reads, direction, vendor help and search classifications intact. This rechecks archived evidence; it does not claim new live reads or a new whole-App audit revision. `pnpm install --frozen-lockfile`, merge-loss and whitespace checks pass (0). The push starts fresh required CI; no gate or timeout is changed.

Fix validation: `just ready` passes (0), including 193 lint fixtures, web/package type checks, repository/Rust lints, `ALL PROOFS CHECK` and N7. No behavior test file changed and the failed task names no failing behavior test. The original sixteen `a5168` passes remain the behavior observation for this documentary slice.
