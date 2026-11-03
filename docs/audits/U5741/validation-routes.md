# U5741 Route control validation

Builder: `builder-41707897567`. Audited main: `ed0924b8e962e9f0e3d08ac7d17e2eb4e35c9d65`. Documentation only: [routes.md](routes.md) assesses explicit Auto, Drop and Route inspection. No product, scenario, contract, test, storage or frozen-loop change. No local `just check`.

| Command / observer | Exit | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Installed isolated worktree dependencies before push. |
| `cargo build -p rup -p rupd` | 0 | Rebuilt current binaries; hashes retained in catalogue. |
| Corrected `python3 /tmp/u5741-route-observer.py` | 0 | Actual method descriptions/help, both real MCP role lists (86 Agent / 94 Door tools), empty/populated CLI reads, six user RPC writes and a semantic CLI authority refusal against a real isolated Daemon. |
| `python3 /tmp/u5741-route-integrity.py` | 0 | 33 archived sources match audited main and checkout; exact offers, schema, CLI syntax, six writes, unchanged post-refusal state and dated owner direction verify. Both observer scripts are archived in the catalogue. |
| `python3 loop/orders.py check /tmp/u5741-route-issue.md` | 0 | Exact documentary scope validated before updating #5758. |
| `git diff --check` | 0 | No whitespace errors. |

The actual user writes use the normal user RPC connection. Shared `rup` Route commands identify as an Agent; the live CLI reads use a synthetic non-Door id or an unstarted Workstream's real Door id. MCP replies are actual `tools/list`, not `tools/call`. No vendor Agent or App starts. Temporary data and configuration directories isolate every fixture write. The observer terminates only its own Daemon; shutdown -15 is intentional TERM, not a failure. No owner Project, usage history, credential change, real inbox delivery or post-retirement reopening is claimed.

The catalogue compares the 33 inspected sources with the earlier public census at `0ff0b698e2cc3768a6ae316b9f829e52b20808f7`: only `docs/wireframes.md` changed. Current source is inspected and archived; earlier App renderings keep their original revisions. This slice's public textual controls have no new mounted App view or visible behavior change, so it adds no screenshots or native-look claim. Conditional App coverage, other public method decisions, broader comparisons in earlier reports and one current whole-App revision remain required before the single owner request.

## Failures and corrections

| Command / observer | Exit | Failure and disposition |
| --- | ---: | --- |
| Initial `test -d .codegraph` probe | 1 | No index in checkout; ordinary repository discovery used. Surrounding shell completed successfully. |
| `cat .claude/sound/resilience/fail-loud.md` | 1 | Guessed rule path absent; `rg --files .claude/sound/resilience` located the actual files. No product or observer conclusion follows. |
| `rg -n 'struct SpawnParams\|struct CreateWorkstreamParams' crates/contracts/src/agent.rs` | 1 | Definitions are re-exported from `agent/launch.rs`, as the corrected registration search finds; no missing-contract claim. |
| `cat tools/file-size/limits.json` | 1 | Guessed configuration absent; actual guard source defines the 1,000,000-byte Git blob limit. No limit exemption assumed. |
| Initial `python3 /tmp/u5741-route-observer.py` | 1 | `rup route list --json` exited 2: shared CLI commands require `--agent` or `ROUNDUP_AGENT`. Corrected CLI reads to specify identity and user-owned writes to use user RPC. Original replay retained. |
| Initial `rup route set --from you --to 1 --delivery drop --agent 1 --json` | 2 | CLI fields are positional, as actual help shows. Self-review caught that the first observer treated this usage failure as an authority refusal. Corrected invocation is `rup route set you 1 drop --agent 1 --json`; observer now requires exit 1 and the self-route `FORBIDDEN` reason. Invalid probe and correction retained separately. |
| Corrected `rup route set you 1 drop --agent 1 --json` | 1 | Expected real Daemon refusal: `route-audit may not set a Route to itself (FORBIDDEN)`. Following list equals the pre-refusal state. This is a passing refusal observer, not successful mutation or proof of every ownership branch. |

No failed or misclassified probe is promoted to a pass. The named existing store/Daemon tests additionally check user-route ownership, Reach, default behavior, pending preservation and reopening; they do not prove a future deletion opens older Projects. No owner choice or deletion is made.
