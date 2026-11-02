# U5741 observer log

Audited source: `092fcafbf` (full SHA in README and runtime provenance). This is a documentary evidence slice. No product code, scenario, Principle, contract, storage reader or test changed. No deletion has been selected, so no retirement/reopen pass is claimed. No Mac-only observation is requested.

| Command / observer | Exit | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Installed the pinned dependencies in the isolated audit worktree. |
| `cargo build -p rup --bins` | 0 | Rebuilt the observed CLI/MCP binary from the audited checkout. |
| `cargo build -p rupd --bin rupd` | 0 | Rebuilt the real Daemon used by the public endpoint observer. |
| `python3 /tmp/u5741-runtime.py` | 0 | Fresh temporary git Project, explicit isolated data/socket; real Daemon ping, one unstarted Workstream, actual stdio initialize/tools-list for both role classifications, public api-list. 91 Agent tools, 98 Door tools, 169 methods. Process stdin closed and Daemon exited afterward. Full replies, executable hashes and role setup are retained in public-seams.json. |
| Reconciliation of runtime methods and declarations | 0 | All 169 match; no source-only/runtime-only methods; no unmatched tool methods; each shared CLI invocation appears in actual help. Explicit top-level/internal CLI commands are separately inventoried. |
| `rup help`, `rup help skill`, `rup actions --help`, `rup do --help` | 0 each | Exact output retained, including options and role restrictions. |
| `pnpm exec claude --version`, `pnpm exec claude --help` | 0 each | Installed Claude Code 2.1.300; no model turn or login attempted. |
| `gh --version`, `gh pr checks --help`, `gh pr diff --help`, `gh pr view --help` | 0 each | Installed vendor command evidence retained. |
| `agent-browser doctor --offline --quick` | 0 | Headless isolated setup available; no user's browser/desktop connection. |
| `python3 /tmp/u5741-render.py` (corrected evaluation) | 0 | Initial seeds and five App Settings pages captured with existing isolated harness. |
| Rendered readings retained in rendered.json | 0 | 33 captured states; every retained D2/D5/D6 reading passes. This does not assert the remaining unrendered surfaces or native behavior. Images stay uncommitted under artifacts/ux/U5741. |
| `python3 tools/lint/scan.py typos` after repair | 0 | Documentary spelling issue repaired; raw wrapped-tab snapshot kept with uncommitted capture, not silently corrected. |
| `python3 loop/orders.py check /tmp/u5741-scope.md` | 0 | Exact evidence-file scope added to #5758 before the evidence commit. |

## Failed commands

Each row is a failure, not a pass. Temporary driver scripts were run outside the product tree and are not new product machinery.

| Command | Exit | Failure / disposition |
| --- | ---: | --- |
| `ls -d .codegraph` | 2 | Index absent; normal source search used. No index created. |
| `cat .cargo/config.toml` | 1 | File absent; existing CARGO_TARGET_DIR read from environment instead. |
| `ls target/debug/rup*` | 2 | Local target directory absent; actual shared target directory located, then binaries rebuilt. |
| `cat crates/rup/src/bin/rupd.rs` | 1 | Wrong discovery path; Daemon is crates/rupd/src/main.rs, read before use. |
| `rg ... crates/contracts/src/rail.rs ...` | 2 | No such module; types found in agent.rs and method declarations. |
| `rg ... scenarios/ui-settings.md scenarios/ui-naming.md scenarios/ui-resources.md` | 2 | Guessed paths absent; actual owning settings/naming scenarios located and read. |
| `agent-browser eval 'JSON.stringify((await import("/src/keys/actions.ts")).listActions())'` | 1 | Top-level await/import syntax rejected by evaluator. Replaced with an async function expression; actual catalogue then collected successfully. |
| `python3 /tmp/u5741-render.py` (initial attempt) | 1 | Aborted on that evaluation failure; rerun after repair. |
| `python3 /tmp/u5741-more-render.py` | 1 | Exact counted Pads tab locator was unavailable. Several earlier capture labels also did not correspond to a newly opened surface; discarded. This run establishes no Inbox/new-Workstream/prompt-dialog pass. |
| `agent-browser find role tab click --name 'PADS 4' --exact` (both discovery attempts) | 1 each | Count-sensitive locator failed. Final observer targets stable shelf-tab-pads and checks its selected state; Pads list capture retained. |
| `agent-browser wait --text 'Opening prompt'` | 1 | Wait timed out: actual Mode field is First prompt. Reopened in a clean page and observed the actual dialog. |
| `agent-browser wait --text 'New Agent'` | 1 | Guessed copy did not identify the inline prompt surface. No capture accepted. |
| `agent-browser wait --text 'Work'` | 1 | Text wait did not identify textbox accessible name. Replaced with textarea.spawn-prompt-field selector and captured the actual field. |
| `python3 /tmp/u5741-interact.py` (three attempts) | 1 each | Aborted respectively at the above three waits. Only later independently recaptured surfaces are retained. |
| `agent-browser wait --fn 'document.body.innerText.includes("Inbox")'` | 1 | Timed out after the leader sequence; Inbox opening remains unverified. |
| `python3 /tmp/u5741-final-render.py` | 1 | Pads and loaded Import captures completed; script then aborted on the Inbox wait. No Inbox capture accepted. |
| `rg ... /home/boxd/.cargo/registry/src/*/tauri-*/src/menu/menu.rs` | 2 | Guessed registry path absent. Complete Tauri default native-menu reconciliation remains engineering work. |
| `wc -l docs/audits/U5741/* ...` | 1 | Glob included a directory; file counts still printed. No verification claim depends on it. |
| `just ready` (initial run) | 1 | lint-web completed, but lint-rust's repository spelling scan rejected the report's image abbreviation and wrapped tab-name fragments in raw accessibility text. Launch-sites passed. Repaired prose and kept the exact wrapped snapshot with the uncommitted capture; no lint exclusions or product changes. Final run recorded below. |

## Final checks

The final `just ready` result is pending. No local `just check`, whole Rust crate test suite, or whole Vitest suite is run. No behavior test is added to check report wording. CI remains the observer for an eventual implementation head's full check.
