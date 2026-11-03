# U5741 Route control validation

Builder: `builder-41707897567`. Audited main: `ed0924b8e962e9f0e3d08ac7d17e2eb4e35c9d65`. Documentation only: [routes.md](routes.md) assesses explicit Auto, Drop and Route inspection. No product, scenario, contract, test, storage or frozen-loop change. No local `just check`.

| Command / observer | Exit | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Installed isolated worktree dependencies before push. |
| `cargo build -p rup -p rupd` | 0 | Rebuilt current binaries; hashes retained in catalogue. |
| Corrected `python3 /tmp/u5741-route-observer.py` | 0 | Actual method descriptions/help, both real MCP role lists (86 Agent / 94 Door tools), empty/populated CLI reads, six user RPC writes and a semantic CLI authority refusal against a real isolated Daemon. |
| `python3 /tmp/u5741-route-integrity.py` | 0 | 33 archives match audited main; checkout matches except the separately archived Glossary merge delta. Exact offers, schema, CLI syntax, six writes, unchanged post-refusal state and dated owner direction verify. Both observer scripts are archived in the catalogue. |
| `python3 loop/orders.py check /tmp/u5741-route-issue.md` | 0 | Exact documentary scope validated before updating #5758. |
| Final `just ready` on merged checkout | 0 | All lints, type checks, migration guard, `ALL PROOFS CHECK` and N7 pass. Exact output retained in catalogue. |
| `just lint-web` after main merge | 0 | All web lints and type checks pass on incoming App/menu changes; exact output retained in catalogue. |
| `git diff --check` | 0 | No whitespace errors. |
| `cargo nextest run -p messages -E 'test(tests::routes::)'` | 0 | All nine existing Route/store tests pass, including default Auto, pair isolation, user ownership, pending preservation and reopening. No test edited. |
| `cargo nextest run -p rupd --lib -E <eight exact Route contract test names>` | 0 | Eight existing real in-process Daemon tests pass: non-Agent Auto inbox delivery/Drop, stored choices, pending identity, Reach, self-routing and user-route ownership. Exact command and output retained in catalogue `behaviorTests`. No test edited. |
| `loop/rules.sh vocab`, `loop/rules.sh scenario-ids`, `loop/rules.sh merge-loss` | 0 | Vocabulary, scenario identities and merge preservation pass. |
| Standalone spelling/size scans and Git blob-size guard | 0 | Corrected tool setup and all size limits pass; historical baseline debt retained. |

The actual user writes use the normal user RPC connection. Shared `rup` Route commands identify as an Agent; the live CLI reads use a synthetic non-Door id or an unstarted Workstream's real Door id. MCP replies are actual `tools/list`, not `tools/call`. No vendor Agent or App starts. Temporary data and configuration directories isolate every fixture write. The observer terminates only its own Daemon; shutdown -15 is intentional TERM, not a failure. No owner Project, usage history, credential change, real inbox delivery or post-retirement reopening is claimed.

The catalogue compares the 33 inspected sources with the earlier public census at `0ff0b698e2cc3768a6ae316b9f829e52b20808f7`: only `docs/wireframes.md` changed. Current source is inspected and archived; earlier App renderings keep their original revisions. This slice's public textual controls have no new mounted App view or visible behavior change, so it adds no screenshots or native-look claim. Conditional App coverage, other public method decisions, broader comparisons in earlier reports and one current whole-App revision remain required before the single owner request.

## Failures and corrections

| Command / observer | Exit | Failure and disposition |
| --- | ---: | --- |
| First standalone `python3 tools/lint/scan.py typos` | 2 | Pinned tool not installed yet; ran `python3 tools/lint/setup.py web` before retry. |
| First `just ready` | 1 | Its nested `just lint-rust origin/main` exited 1 because `python3 tools/file-size/guard.py origin/main` exited 2: the partial checkout lacked main’s new Glossary blob `af6457c143ea14e1bf6cfdacd191e1f331769ea9` during the concurrent fetch/merge. Merge hydrated it; standalone guard passes (0). All remaining checks, proofs and N7 completed. Rerun on the merged checkout required. |
| Initial `test -d .codegraph` probe | 1 | No index in checkout; ordinary repository discovery used. Surrounding shell completed successfully. |
| `cat .claude/sound/resilience/fail-loud.md` | 1 | Guessed rule path absent; `rg --files .claude/sound/resilience` located the actual files. No product or observer conclusion follows. |
| `rg -n 'struct SpawnParams\|struct CreateWorkstreamParams' crates/contracts/src/agent.rs` | 1 | Definitions are re-exported from `agent/launch.rs`, as the corrected registration search finds; no missing-contract claim. |
| `cat tools/file-size/limits.json` | 1 | Guessed configuration absent; actual guard source defines the 1,000,000-byte Git blob limit. No limit exemption assumed. |
| Initial `python3 /tmp/u5741-route-observer.py` | 1 | `rup route list --json` exited 2: shared CLI commands require `--agent` or `ROUNDUP_AGENT`. Corrected CLI reads to specify identity and user-owned writes to use user RPC. Original replay retained. |
| Initial `rup route set --from you --to 1 --delivery drop --agent 1 --json` | 2 | CLI fields are positional, as actual help shows. Self-review caught that the first observer treated this usage failure as an authority refusal. Corrected invocation is `rup route set you 1 drop --agent 1 --json`; observer now requires exit 1 and the self-route `FORBIDDEN` reason. Invalid probe and correction retained separately. |
| Corrected `rup route set you 1 drop --agent 1 --json` | 1 | Expected real Daemon refusal: `route-audit may not set a Route to itself (FORBIDDEN)`. Following list equals the pre-refusal state. This is a passing refusal observer, not successful mutation or proof of every ownership branch. |

No failed or misclassified probe is promoted to a pass. The named existing store/Daemon tests additionally check user-route ownership, Reach, default behavior, pending preservation and reopening; they do not prove a future deletion opens older Projects. No owner choice or deletion is made.

Replay: extract `replay` and `integrityObserver` from the checked-in catalogue to Python files and substitute the worktree root in each. The runtime replay reads dated direction and failed-attempt records from that existing catalogue, so it needs no untracked temporary evidence files. Build the pinned binaries and install dependencies first. Runtime state/timestamps are freshly observed; archived direction and failures remain historical.

Merged main `1dda6f6f2b6e6892d5bb2ed98b2a797de63ae249` without conflicts; `git show --remerge-diff` shows no resolution edits and `loop/rules.sh merge-loss` passes (0). Only `GLOSSARY.md` changes among the 33 inspected sources: five added closed-loop terms. The catalogue preserves its exact diff/current archive separately from the original audited sources. Route code/contracts are unchanged; incoming App menu/selection changes are not claimed reconciled by this slice. The integrity observer verifies pinned archives plus that explicit merge delta.

Final self-review: the own-commit diff contains only the seven scoped audit documents. The 9 store and 8 real-Daemon Route tests pass; corrected runtime/integrity observers, post-merge web checks, final readiness, spelling, size, vocabulary, scenario ids, whitespace and merge-loss pass. The first failed readiness run remains preserved separately. CI and independent review judge the pushed head; no future merge or completed all-feature audit is claimed.
