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

| `just ready` (second run) | 1 | Repository spelling scan rejected wrapped fragments in the Import panel snapshot; moved exact raw text beside its uncommitted capture, retaining Check readings and explicit disposition in rendered.json. |

## Final checks

The second `just ready` exited 1: all web checks and launch-sites passed, but the repository spelling scan found additional wrapped fragments in the Import panel raw snapshot. That exact snapshot is now retained with the uncommitted capture, with its disposition recorded in rendered.json. No text was corrected and no lint exception added. The repaired spelling scan passed (exit 0); another full ready run remains required for continuation. No local `just check`, whole Rust crate test suite, or whole Vitest suite is run. No behavior test is added to check report wording. CI remains the observer for an eventual implementation head's full check.

## Continuation on builder-41533806779

The evidence remains pinned to main `092fcafbf910f292d7180c97d35bd381aff984b3`. The continuation's isolated worktree merges main `b7ce9aef7` for branch validation; it does not silently repin the older runtime census or claim its offers cover methods added later. Browser observations run against the unchanged audited checkout on port 5218, in a new headless session/profile. No user browser, Agent process or native App was used.

| Command / observer | Exit | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Pinned dependencies installed in the continuation worktree. |
| `just ready` | 0 | Lints, proof checks (`ALL PROOFS CHECK`) and N7 launch-sites observer pass; no product behavior or test changed. |
| `loop/rules.sh merge-loss` | 0 | No main-only file lost through the merge. |
| `git diff --check` | 0 | No whitespace errors. |
| Download and SHA-256 comparison of locked Tauri/muda archives | 0 | Both archives match Cargo.lock checksums; inspected exact Tauri 2.12.1 default builder and muda 0.20.0 labels, accelerators and native selectors. Native construction inventory is in native-menus.md. |
| `agent-browser doctor --offline --quick` | 0 | Isolated headless setup passes. |
| `just harness tree-40 5218` lifecycle | 143 on deliberate shutdown | Served the audited checkout successfully. After captures, the run closed its own browser and stopped only this server; signal termination is not an observer pass/fail. |
| Follow-up captures | 0 for each retained opening | Twelve openings retained: eleven pass every D check; Project rename retains a pre-existing D6 failure and its D10 aggregate. `rendered-followup.json` retains the mounted selectors and exact D-check readings. Raw snapshots and images stay uncommitted beside the captures. Only mounted, successful openings count; failed attempts below do not. |

These discovery/observer failures were repaired without changing product behavior or weakening a gate:

| Command / observer | Exit | Failure / disposition |
| --- | ---: | --- |
| `ls -d .codegraph .claude/sound` | 2 | No codegraph index; normal source search used. Sound rules exist and were read. |
| `git worktree add /tmp/roundup-fix-5780 build/app-feature-audit-implementation` | 128 | Branch already checked out by the provided checkout. Created a detached continuation worktree at the supplied head instead; push targets the requested branch explicitly. |
| `ls /tmp/*5741*` | 2 | Prior run's temporary drivers did not survive. New observer drivers use the existing harness and are not product machinery. |
| `rg --files /home/boxd/.cargo /opt` | 2 | Broad discovery encountered an unreadable unrelated directory; no local Tauri menu source found. Read checksum-verified published archives instead. |
| `cat crates/desktop/src/dock.rs` | 1 | Guessed module does not exist. No native Dock-menu coverage inferred from it. |
| `sed ... apps/desktop/src/testing/harness.ts` | 2 | Harness is harness.tsx; actual source read before extending observations. |
| `rg ... crates/rupd/src/dispatch` | 2 | Guessed directory absent; models.list dispatch is in crates/agents/src/dispatch.rs. |
| `rg ... crates/agents/src/claude_code/naming.rs` | 2 | Guessed module absent; no naming equivalence inferred. |
| `sed ... crates/agents/src/claude_code/naming.rs` | 2 | Same nonexistent module; no candidate assessment changed. |
| `rg ... apps/desktop/src/modes/OpeningPrompt.tsx .../SaveAsMode.tsx` | 2 | Actual components are under rail; read those before dialog observations. |
| `agent-browser wait .todo-row` | 1 | Todo owner group was collapsed; no visible row satisfied the wait. Expanding the real shelf-group-control before Open established the later detail capture. |
| `agent-browser wait '[role=menu]'` after `click .pad-name --button right` | 1 | Click's documented interface does not support that right-button option. Repaired using real mouse move/down/up right and retained the resulting actual menu. |
| `agent-browser mouse move 1320.3359375 188` | 1 | CLI requires integer coordinates. Rounded the measured target centre and used the real mouse API. |
| `agent-browser scrollintoview '.rail-row[data-id="token-rotation"]'` | 1 | Used the displayed name as an id. Actual row id is tokens; repaired from the rendered DOM. |
| `agent-browser find role button click --name 'Unassigned 7' --exact` (two attempts) | 1 each | Locator returned not found. No successful group-opening assertion is based on it; subsequent DOM inspection established the available Todo controls. |
| `agent-browser wait .todo-drawer` | 1 | Wrong content class; the implementation uses todo-detail. No capture retained from this failed wait. |
| Follow-up aggregate assertion that every captured Check passed | 1 | Project rename failed D6/D10. Retained the exact failure instead of claiming a pass; #5786 owns the observer repair. |
| `rg ... scenarios/ui-project-tabs.md` | 2 | Guessed file absent; owning visual/macOS acceptance found through the scenario census instead. |
| `agent-browser wait .todo-detail` | 1 | Todo group was collapsed, so clicking its hidden descendant opened no detail. Repaired the observer to expand the real group control before clicking its visible Open action; no pass claimed from the hidden control attempt. |

The Project rename input omits its type attribute. `testing/checks.ts::d6` tests the explicit type attribute instead of the browser's effective text type and demands button hover/cursor behavior. [#5786](https://github.com/roundup-app/roundup/issues/5786) owns this observer repair under U133. The audit does not change that observer or add button styling to a text field.

No owner choice has been requested. The remaining work is the full App/local-library key reconciliation, per-row three-criterion assessment and linked owner direction. This evidence slice keeps #5758 open; it is not retirement permission or complete U5741 acceptance.

## Keyboard evidence continuation — builder-41540564606

The source observer stays pinned to main `092fcafbf910f292d7180c97d35bd381aff984b3`; the documentary continuation branches from `d1c8a3cc90ab96eab7c57d3c300c5bddd97570e3`. The two checkouts are separate worktrees. No current-main product source is substituted into the old audit. No product, scenario, Principle, contract or frozen-loop file changes.

`pnpm install --frozen-lockfile` passed in both worktrees (exit 0). The keyboard census retains 67 production files / 146 matching sites, 21 locked-library files and 60 actual named-action rows. The observer driver and reconciliation scripts are temporary audit tools, not product machinery or committed report-wording tests. `agent-browser skills get core` was read before browser commands. The headless session is `u5741-41540564606`, with a fresh test profile; only this run's isolated pages and fake Project were edited.

Failed commands and observations are retained below, including discovery mistakes. A command chain's exit is the reported shell exit; no result following its failed `&&` was inferred. The rendered report retains individual failed browser commands too.

| Command / observer | Exit / status | Failure and disposition |
| --- | --- | --- |
| Initial `pwd && git status --short && git rev-parse HEAD && test -d .codegraph && echo codegraph-present` | 1 | No `.codegraph` directory; normal source discovery used. |
| `cat ... pads/PadRichEditor.tsx pads/editor.ts keys/Help.tsx` | 1 | Guessed editor.ts absent; actual implementation is PadRichEditor.tsx and its installed dependencies. |
| `rg ... milkdown/preset-commonmark/src` before dependency installation | 2 | Package not installed yet. Installed the pinned lockfile, then read actual sources. |
| `cat docs/audits/U5741/rendered-followup.json` in the older source worktree | 1 | Evidence was added after the audited product revision; read it from the continuation checkout instead. |
| `cat apps/desktop/src/keys/menu.ts` | 1 | Guessed path absent; native projection is documented in native-menus.md and the actual App/native sources. |
| GitHub connector `github_update_issue` (two attempts) | HTTP 403 | Integration cannot update Issues. `gh issue edit ... --body-file /tmp/u5741-issue-5758.md` succeeded after `python3 loop/orders.py check` exit 0. |
| `sed ... keys/projectMenu.ts` | 2 | Guessed module absent; inspected the actual Strip, App and menu projection. |
| `sed ... ui/RowCollection.tsx` | 2 | Actual module is RowCollection.ts; read before documenting inherited collection behavior. |
| `just harness tree-40 5216` before installation finished | 1 | Vite executable unavailable during install. Restarted after installation; Vite served the pinned source. |
| First `agent-browser wait .rail` | 1 | Timed out during initial dependency compilation/navigation. Reopened and waited for mounted App; no pass based on blank page. |
| `rg ... apps/desktop/src/undo` | 2 | Guessed directory absent; actual focused history bindings are in App.tsx. |
| `rg ... scenarios/ui-switcher*` | 2 | Guessed scenario glob absent; located acceptance through the real scenario file census. |
| `rg ... apps/desktop/src/terminal/key*` | 2 | Guessed module glob absent; actual editing-byte rules are in terminal/emulator.ts. |
| `python3 /tmp/u5741-render-more-keys.py`, first attempt | 1 | `.rail-root` focus target absent. No Help capture accepted. |
| Same driver, second attempt | 1 | `h1` focus target absent while Drawer was open. Used the actual Drawer Close control, then the ordinary Help key. |
| Same driver, third attempt | 1 | Guessed `Find key` label absent. Inspected snapshot and used actual `Find a key`. Earlier independently captured surfaces retained only after dark-mode recapture. |
| `python3 /tmp/u5741-render-recording.py` | 1 | Exact New Agent label locator failed after leaving find-key mode. No action-recording capture or successful recording claimed. |
| `python3 /tmp/u5741-verify-report.py`, first attempt | 1 | Whole-report token count included prose references as well as action rows. Repaired observer to count table rows. |
| Same verifier, second attempt | 1 | Browser evaluator returned nested serialized state. Parsed the state object before checking it. |
| Same verifier, third attempt | 1 | Independent scheme assertion found initial images were light: `set media --color-scheme dark` was silently ineffective. Read CLI help; discarded those images/readings and recaptured using documented `set media dark`. |
| `python3 /tmp/u5741-render-dark.py`, first attempt | 1 | Shelf toggle closed an already-open Shelf; tabs wait timed out. No dark pass accepted. |
| Same dark driver, second attempt | 1 | Assumed `items=1` left Shelf open; Open pad-3 was unavailable. Inspected actual closed state, opened via real leader keys, then used mounted Shelf and visible Pad Open. |
| Same dark driver, third attempt | 1 | Reclicked the active Pads tab and closed Shelf; no capture accepted. Subsequent driver checks actual Shelf/tab state before acting. |
| Same dark driver, fourth attempt | 1 | Nested serialization hid the closed state from the conditional; timed out waiting for open Shelf. Read the raw attribute correctly and retried. |
| `agent-browser snapshot -i -s .pads-tab` during that closed state | 1 | Selector absent because Shelf was closed; no Pad reachability inferred. |

The single complete owner request, all three criteria per independent feature, configured-widget and source-only key probes, other App states and endpoint/direction assessments remain work on #5758. This slice requests no keep/delete choices and retires nothing. Older-Project reopening remains mandatory for each later owner-selected deletion.

Final keyboard observer: seven openings at 1512×950 with actual dark media, each with every recorded D Check passing. The verifier requires exactly seven pages, maps all 60 action table names once, checks all 67 App and 21 library full-file hashes, and asserts dimensions, dark state, capture presence and no failing Check (exit 0). Source-only offers remain explicitly unverified. No behavior test was added: U5741 makes this documentary acceptance policy and prohibits report-wording tests.

The dark driver also required distinguishing the already-selected Pads tab from an unopened tab: selecting the active tab closes the Shelf. Its final successful run reads that actual selected/open state before acting. Two shell-driver attempts exited 1 on the same unavailable Pad Open locator and one on the open-Shelf wait before those state/serialization repairs; the rendered report preserves the individual failures. Empty page collections are refused by the final seven-page verifier.

The GitHub connector also refused `github_create_pull_request` with HTTP 403; `gh pr create --draft --body-file /tmp/u5741-pr-body-41540564606.md` succeeded, opening #5796. No automatic approval review rejected an action; these were API integration permissions. The Issue scope edit and draft PR used the already-authorized repository workflow.

Final code-recipe checks: `just ready` passed (exit 0), including web lint/typecheck, Rust lint/proofs and N7's launch-site observer. `loop/rules.sh vocab`, `loop/rules.sh scenario-ids`, `loop/rules.sh merge-loss` and `git diff --check` passed (exit 0). No local `just check`, whole behavior suite or native Mac observer ran. The documentation-only diff adds no public function or behavior test. Final diff review checked source/registry ownership, duplication, placement and explicit limits; it corrected stale acceptance citations for Mode restart, owner assignment and Terminal text keys.

## Required-check repair — builder-41546242110

PR #5796's `pre` run [41543913546](https://github.com/roundup-app/roundup/actions/runs/41543913546) failed in Clippy: `crates/agents/src/lib.rs` defined the test global allocator twice (E0428 and “cannot define multiple global allocators”; recipe exit 101). The duplicate is inherited from main, also tracked by #5798. This continuation merges main `fc5d51ad8` cleanly and removes only the second declaration. The retained shared allocator, allocation observers and thresholds are unchanged. #5758's scope records the required-check repair; audit sources remain pinned to their original revision.

| Command / observer | Exit | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Installed the unchanged lockfile in the isolated continuation worktree. |
| `cargo check -p agents --tests` | 0 | The formerly failing test target compiles with one global allocator. |
| `cargo nextest run -p agents -E 'test(r5636e_nested_rail_allocated_bytes) \| test(r5636e_scan_allocated_bytes) \| test(b5635b_preview_allocations_stay_bounded)'` | 0 | All three existing allocation observers pass; no other behavior tests ran. |
| `just ready` | 0 | Web lint/typecheck, workspace Clippy, Rust policy scans, `ALL PROOFS CHECK` and N7 launch-site observer pass. |
| Vocabulary, scenario ids, merge-loss and whitespace checks | 0 | No vocabulary, scenario identity, main-only merge loss or whitespace violation. |

No new test duplicates the compiler's global-allocator uniqueness check (rule 10). No UI behavior, scenario, contract or frozen-loop change was authored. Diff review confirmed the deletion preserves every allocator caller and introduces no new machinery.

## Settings evidence — builder-41556795106

Product source remains `092fcafbf910f292d7180c97d35bd381aff984b3`; documentation continues from main `df38b366e772e810592e7d19b3b8d04adb8419c7`. Own branch/worktree and a separate detached product-source worktree preserve that boundary. The new catalogue lists product changes between them, not an audited disposition of that delta.

Passed: `pnpm install --frozen-lockfile` in both worktrees (exit 0); `cargo build -p rup -p rupd` at the audited source (exit 0); `python3 loop/orders.py check /tmp/u5741-5758-41556795106.md` (exit 0) before the authorized documentation scope update. Rebuilt binary hashes and the isolated real Daemon's actual `models.list` request/reply are in `catalogues/settings-source.json`. No Agent is launched. Ten settings openings at 1512×950 in dark pass every recorded D Check, including D2/D5/D6. PNG files and raw snapshots stay under `artifacts/ux/U5741/settings/`; exact controls/values and Checks are in `rendered-settings.json`.

The existing fake App has separate `of("")` global calls: changing a Project's skill handler does not supply Settings' global installation read. The corrected observer supplies only that isolated global fixture. It establishes actual outdated/foreign presentation, never a real file installation. The New Agent recorder opens, but neither the CLI chord nor the single evaluated key saved an override; Reset/export rendering remains unverified. Earlier labels claiming an override were discarded and their image removed. No product behavior change or bug conclusion rests on these observer failures.

Each failed command below failed; later unrelated commands in a shell do not convert it into a pass. Temporary drivers are observers outside the product tree, not new product helpers.

| Command / observer | Exit / status | Failure and disposition |
| --- | --- | --- |
| Initial `ls -d .codegraph .claude/sound` | 2 | No codegraph index; sound directory exists. Normal source search used. |
| `cat .../settings/pages.ts` in the first settings read | 1 | Guessed module absent; actual control registry is in AppSettings.tsx and was read. |
| `rg ... claude_code/*naming* ... app/notifications.ts` | 2 | Guessed paths absent; actual naming delivery and rail/stateAlerts.ts found from the file census. |
| Python catalogue read in the detached product-source worktree | 1 | Audit reports postdate the product revision; loaded them from the continuation checkout instead. |
| `rg ... claude_code/hooks*` | 2 | Guessed glob absent; no equivalence conclusion depends on it. |
| `cat .../app/stateAlerts.ts` | 1 | Actual module is rail/stateAlerts.ts. |
| `cat .../settings/ShortcutRow.tsx .../app/alerts.ts` | 1 | Both guessed modules absent; actual owners are ShortcutSetting.tsx and rail/stateAlerts.ts. |
| `cat .../toasts/watch.ts .../toasts/policy.ts` | 1 | Actual watch is watch.tsx; no policy module inferred. |
| `rg ... scenarios/ui-agent-naming.md ... scenarios/ui-settings*` | 2 | Guessed path/glob absent; actual naming and settings scenarios located by file census and read. |
| Python `rendered-keyboard.json['pages'][0]` discovery | 1 | Pages is a name-keyed object, not an array; no evidence accepted from that expression. |
| `cat docs/audits/U5741/rendered-keyboard.json` in the pinned source worktree | 1 | Report does not exist at that older product revision; read it from the continuation checkout. |
| `rg --files /tmp` discovery | 2 | Unrelated private directories unreadable. Shared Cargo target was read directly from CARGO_TARGET_DIR. |
| `agent-browser find role button click --name 'Engine Use the default' --exact` | 1 | Exact composite accessible-name locator failed. Actual mounted trigger selected through its popover attributes. |
| `agent-browser find nth '.settings-content button[aria-haspopup=dialog]' 0 click` | 1 | Arguments reversed; corrected documented order to index then selector. |
| `agent-browser find role button click --name 'New Agent ⌘N' --exact` | 1 | Composite name locator failed. Actual current snapshot ref used; Press a shortcut state captured. |
| `agent-browser find role button click --name Reset --exact` | 1 | No Reset existed. The preceding text wait matched Reset text size, not a Reset control; that override image was discarded. |
| `python3 /tmp/u5741-settings-rest.py` initial discovery | 1 | Reset ref search returned none; no Reset behavior or capture accepted. |
| `agent-browser wait --fn 'Array.from(document.querySelectorAll(".settings-content button")).some(e=>e.textContent==="Reset")'` | 1 | Timed out; supplied chord left the recorder active. No saved override or export pass claimed. |
| `agent-browser wait --fn 'Array.from(document.querySelectorAll("button")).some(e=>e.textContent==="Update")'` | 1 | Timed out because fixture changed the Project handler instead of global `of("")`; corrected fixture yielded actual Update. |
| `rupd --help` | 1 | Daemon takes a positional Project; it treated --help as a nonexistent directory and refused. Read main.rs/data.rs before starting an isolated Project with dedicated data and socket. |
| `rup models list` | 2 | No CLI leaf named models; source registry exposes models.list as RPC. Used the existing newline JSON-RPC socket seam, preserving its actual reply. |
| `rg ... crates/rupd/src/config.rs` | 2 | Actual data configuration lives in data.rs; read before isolated launch. |
| `rg ... crates/rupd/src/server.rs` | 2 | Guessed server path absent; request framing verified in rpc/src/client.rs. |
| Apple notification page open, canonical URL | HTTP 429 | Browser tool could not fetch. Primary Apple search result and alternate regional source establish only app-scoped controls; no native observation claimed. |
| Apple notification page open, UK regional URL | HTTP 429 | Same access failure; not a second successful source. |
| First report reconciliation Python assertion | 1 | DOM control census included hidden lazy-mounted tabs; classified it explicitly as mountedControls. Actual accessibility snapshot has the fifteen visible alert switches. No visibility pass inferred from the broader census. |
| First `git commit` | 1 | Pretty-printed generated readings exceeded the 1000-line file gate. Serialized the readings compactly, matching rendered-keyboard.json; hook then passed, with no rule change. |

The final documentary checks and `just ready` result are recorded below. Final self-review retained E7 as unverified: Apple supports rebinding existing menu commands, so different preference storage cannot justify a negative equivalence answer. Menu titles and native/webview scope still need per-row reconciliation. No local `just check`, whole test suite or report-text test runs.

| Command | Exit | Result |
| --- | --- | --- |
| `just ready` (first run) | 1 | lint-repo spelling scan rejected the plural image abbreviation in this log. Replaced it with PNG files; web lint/typecheck and launch-sites passed. Required rerun recorded below. |

Harness process log also reported four `ResizeObserver loop completed with undelivered notifications` errors during navigation; these remain observer diagnostics, not a product fix or a native behavior pass. The final ten retained screens each independently passed their recorded Checks. Browser and both isolated serving processes were closed by this run after collection.

Fetched and merged main `b0562bd815f4f986b981b1c024e989328dd1489f` without conflicts; `loop/rules.sh merge-loss` passes (exit 0). Pinned product source and its observations remain unchanged. The production-path delta catalogue is refreshed through this merge.

| Command | Exit | Result |
| --- | --- | --- |
| `just ready` (second run) | 1 | Spelling scan found the same plural image abbreviation in settings-evidence.md. Replaced every new occurrence; web lint/typecheck and launch-sites passed. No baseline, spelling exception or product change. |

Final reconciliation passed (exit 0): sixty unique configuration rows match the runtime catalogue; inspected files match their pinned hashes; the real model reply names only Claude Code; all ten nonempty retained pages pass every recorded Check and have paired PNG files; the actual Alerts snapshot contains fifteen switches and the actual recorder says Press a shortcut. No override image remains. Vocabulary, scenario ids, whitespace and post-merge merge-loss pass (exit 0). Standalone `just lint-rust origin/main` passes (exit 0), including `ALL PROOFS CHECK`; its first successful run installed the existing pinned Lean toolchain. No test file was changed or newly required by this documentation-only slice.

`just ready` final rerun passes (exit 0) on the merged checkout: web lint, typecheck, Rust/repository lint, proofs and N7 launch-sites. The only subsequent change records this result. No local `just check` ran; CI judges the pushed head.

## Required-check repair — builder-41563179878

CI run `41560029671` on `29c2f339ea44b8f4366f33fe7038060b55dcf670` failed `lint` (exit 1): Clippy could not compile the agents unit tests (E0425) because the shared `crate::ALLOCATOR` was absent. The dependent `pre` gate failed too. Restore exactly one test-only allocator using the already installed `stats_alloc`; keep every allocation observer and threshold unchanged. Production builds do not register this allocator.

| Command / observer | Exit | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Installed the pinned dependencies in the isolated repair worktree. |
| `cargo nextest run -p agents --lib -E 'test(b5635b_preview_allocations_stay_bounded) \| test(b5635a_receipt_reads_only_appended_bytes) \| test(r5636e_scan_allocated_bytes) \| test(r5636e_nested_rail_allocated_bytes)'` | 0 | All four existing allocation observers pass. No new test duplicates compiler coverage. |
| `git diff --check`, `loop/rules.sh vocab`, `loop/rules.sh merge-loss` | 0 each | No whitespace, vocabulary or inherited merge-loss defect. |
| `just ready` (first repair attempt) | 1 | Started before dependency installation exited; early web checks could not find Babel, Stylelint or TypeScript. Rust lint, proofs and N7 passed. Rerun after installation completed. |
| `just ready` (final repair attempt) | 0 | Web lint/typecheck, workspace Clippy, repository guards, `ALL PROOFS CHECK` and N7 launch-sites pass. No local `just check` ran. |

## Required-check repair — builder-41567182937

CI runs `41565024004` and `41565023990` on `fa9b5c63ca140e8bcbf28ba5364e44638eed1846` failed lint and the macOS/Rust test lanes before tests ran: their merge checkout contained two `ALLOCATOR` declarations (E0428). Main's independently merged #5828 already supplies the shared test allocator. Merge main `fc8f38711` and delete this branch's duplicate; `crates/agents/src/lib.rs` then equals main. Allocation observers and thresholds remain unchanged, and the net PR changes only audit documentation.

| Command / observer | Exit | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Pinned dependencies installed before `just ready`. |
| `git diff --check`, `loop/rules.sh vocab`, `loop/rules.sh merge-loss` | 0 each | No whitespace, vocabulary or inherited merge-loss defect. Main merged without conflicts; its merge has no remerge diff. |
| Targeted `cargo nextest run -p agents --lib` allocation observers | 0 | All six pass: `b5635b_preview_allocations_stay_bounded`, `r5636e_scan_allocated_bytes`, `r5636e_nested_rail_allocated_bytes`, `b5635a_receipt_reads_only_appended_bytes`, `b5635c_unrelated_hooks_do_not_copy_completed_text` and `b5635c_completion_changes_are_reported_once`. |
| `just ready` | 1 | Only `just migrations origin/main` fails: main already contains both `0044-inbox-entry.sql` and `0044-start-attribution.sql`. Existing repair PR #5833 and Issue #5837 own this collision. Web lint/typecheck, Rust/repository guards, `ALL PROOFS CHECK` and N7 launch-sites pass. Clippy skips the documentation-only net diff; the targeted Nextest runs compile the agents unit tests. No local `just check` ran. |


## Required-check repair — builder-41568471071

CI run `41568393992` on `f8495ca8decd9244e0cc8d88307d812e2e9cafba` failed the B4522 filename guard before tests: main contains both `0044-inbox-entry.sql` and `0044-start-attribution.sql`. Carry the exact independently approved repair from PR #5833 (`85f61e537cb70d2cdd923ce947338438ce0071d2`): rename the latter to `0045-start-attribution.sql`. Issue #5758 records this scope expansion; #5837 owns the upstream collision. Neither the guard nor its recorded exceptions change.

| Command / observer | Exit | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Pinned dependencies installed before `just ready`. |
| `just migrations origin/main` | 0 | Filename guard and all nine existing fixture tests pass. |
| Ordered Project SQL comparison against `origin/main` | 0 | All 49 bytewise-sorted SQL contents match exactly; the migration count and applied positions are unchanged. |
| `git diff --check`, `loop/rules.sh merge-loss` | 0 each | Exact rename; no whitespace or inherited merge-loss defect. |
| `cargo nextest run -p rupd --lib -E 'test(r3696c_a_fresh_project_db_equals_the_migrated_one_with_its_own_identity) \| test(n5467)'` | 0 | Four existing observers pass: fresh schema/image equality, older-store refusal without changes, old Project data refusal with retained worktrees, and incomplete reaction-record refusal. |
| `just ready` | 0 | Web lint and typecheck, workspace Clippy, repository guards, `ALL PROOFS CHECK` and N7 launch-sites pass. No local `just check` ran. |

## Changes and resources continuation — builder-41575207304

This documentation slice observes main `f87a3ddd158ec53a311d29265fa6414d6efa4434`, not an unrecorded promotion of the earlier product revision. The changes/resources report and source catalogue reconcile the relevant current declarations, menu projection and inspected implementation hashes. Other production delta and the complete audit remain pending. No product, scenario, Principle, contract, test or frozen-loop file changes; no deletion or owner choice.

| Command / observer | Exit | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Installed pinned dependencies in this run's own worktree. |
| `python3 loop/orders.py check /tmp/u5741-scope-415752.md` | 0 | Validated exact documentary scope before editing #5758. |
| `gh issue edit 5758 --body-file /tmp/u5741-scope-415752.md` | 0 | Added the permitted evidence files and reasons to the canonical work order. |
| `just harness resources 5234` | running observer | Isolated fake-Daemon App from this recorded source, loopback only. |
| `python3 /tmp/u5741-changes-observe.py` and `...-run.py` | 0 each | Fresh dedicated headless session/profile, actual tree opening and requested resource inspection. |
| `python3 /tmp/u5741-changes-more.py` after locator repair | 0 | Diff, source-note fields, saved batch and edit openings retained. A final guessed button hit Old rather than Close; no close pass was inferred from it. Correct action used subsequently. |
| `python3 /tmp/u5741-changes-recovery.py` | 0 | Existing native Project command opens the actual recoverable forms/notes and actions. |
| `python3 /tmp/u5741-changes-failures.py` | 0 | Actionable failed Worktree read, stale resource samples, finished selection and absent measurements. Eleven distinct pages in rendered-changes.json. Nine pass all Checks; note form/edit retain existing D2/D10 failures on resolved automatic margin. |
| `python3 /tmp/u5741-editor-probe.py`, `.../u5741-probes.py` | 0 each | Real tree selection plus Enter reaches the editor seam with the selected Worktree path and line 1; no native editor execution claimed. Catalogue retains exact menu projection and editorCalls. |
| `gh --version`, `gh pr diff/checks/view/review --help` | 0 each | Vendor version and exact supported commands retained; no review posted. |
| `loop/rules.sh vocab`, `loop/rules.sh scenario-ids`, `git diff --check` | 0 each | Documentary vocabulary, ids and whitespace pass. |

| Failed command / observer | Exit / status | Failure / disposition |
| --- | --- | --- |
| Initial `ls -d .codegraph .claude/sound` | 2 | No graph index; sound rules exist. Normal source search used. |
| `sed ... apps/desktop/src/changes/ChangedTree.ts` | 2 | Actual source is ChangedTree.tsx; read it before completing reconciliation. |
| First `python3 /tmp/u5741-changes-more.py` | 1 | Exact semantic locator could not address the shadow tree row. Fresh snapshot ref selected the actual file, then View diff opened it. |
| `python3 /tmp/u5741-changes-states.py` | 1 | Recover notes trigger was no longer open when `.note-recovery` was observed. No trigger pass claimed. Project command observer subsequently opened actual recovery. |
| `python3 /tmp/u5741-changes-final-render.py` | 1 | Resource-value recapture completed, but guessed shadow path attribute wait timed out. No editor pass inferred; actual row ref plus Enter subsequently recorded the correct path/line. |
| `rg ... apps/desktop/src/rail/Worktree*` | 2 | No module matches the guessed glob; chips live in RailRow.tsx, which was read and recorded. |
| Primary Apple process-guide page retrieval | HTTP 429 | Full-page retrieval unavailable. Search excerpt does not prove Agent-tree or directory-size equivalence; Q1 stays unverified. |

PNG files and paired readings remain under artifacts/ux/U5741 in this run's worktree, uncommitted. The final inventory and owner request remain pending, including every unverified row and conditional opening named in changes-resources.md. An existing Check failure is retained as evidence, never converted to a pass. No local `just check` ran.

Observer correction before commit: the first CI fixture used `failure`, outside WorktreeCiState's `failed` variant. All eleven first-session readings and images were discarded. `python3 /tmp/u5741-changes-recapture-rest.py` (exit 0), in fresh session/profile `u5741-415752-r2`, replaces every retained page using the valid contract value; CI reads Failed and PR reads #42. The first recapture attempt (`.../u5741-changes-recapture.py`, exit 1) waited for a CI chip before the shared Worktree read refreshed. Opening the actual Worktree control refreshed the shared state, then the continuation captured it; no chip pass is based on the timed-out wait. This is an observer repair, not a product fix. All eleven final pages have a verified dark 1512×950 environment and no undefined label; nine pass every Check and the two note forms retain D2/D10 only.

The standalone spelling command initially exited 2 because the pinned tool had not been installed in this new worktree. `python3 tools/lint/setup.py web` installed the checksum-verified tools (exit 0); the subsequent `python3 tools/lint/scan.py typos` passed (exit 0). No baseline or rule changed.

Final checks: both `just ready` runs pass (exit 0), including B4522's migration guard, web lint/typecheck, Rust lints, `ALL PROOFS CHECK` and N7 launch sites. Main `0c060bfd8` was merged without conflicts; every inspected source file remains byte-identical to the pinned observer source. `loop/rules.sh merge-loss`, vocabulary, scenario ids, final spelling, JSON/source/editor/menu reconciliation and whitespace checks pass (exit 0). There are no changed behavior tests to run in this documentation-only slice. The complete inventory and final owner ask remain open on #5758.


## Rail lifecycle continuation — builder-41579716823

Product main `a3a760a66f4e2bf91a613636640e649695e6dc65`; isolated worktree `/tmp/roundup-audit-41579716823`. #5741 is closed after its specification merged. #5758's validated body adds the exact documentary slice before edits. No product, scenario, contract, test or frozen-loop change; U5741 uses policy observers, so no report-text test is added. B4522 is observed through the unchanged migration guard in `just ready`.

Successful commands (exit 0): `git fetch origin main`; own branch/worktree creation; `python3 loop/orders.py check /tmp/5758-body.md`; `gh issue edit 5758 --body-file /tmp/5758-body.md`; `pnpm install --frozen-lockfile`; `agent-browser skills get core`; `just harness tree-40 5223` served successfully (long-running server, not a completed test); `node_modules/.bin/claude --version` and `--help`; linked #4547/#5214/#4452/#3194 direction retrieval.

Thirteen actual openings at 1512×950, dark, fresh headless profile `/tmp/u5741-rail-profile-41579716823`, dedicated session `u5741-rail-41579716823`, pass all recorded D Checks. Fonts, viewport and dark preference are checked on each capture. PNG files and raw snapshots remain uncommitted under `artifacts/ux/U5741/rail/` for workflow attachment. Visually inspected New Mode and middle-Queue images agree with their openings. Native Stop/Keep is observed at the existing question boundary, not drawn as a web dialog. No real launch, permission change, native macOS render or Message delivery is claimed.

Eight additional exact native menu models are observed without `menu=1` through the existing menuProbe. Each top-level label reconciles to its corresponding projected-menu accessibility snapshot; first/middle/last Queue menus differ in the expected directional offers. The source catalogue retains complete nested models, fixture drivers and checksummed inspected source. The generated JSON uses compact serialization as the existing evidence does; it is not handwritten product machinery.

| Failed command / observer | Exit | Failure / disposition |
| --- | ---: | --- |
| Initial `pwd && git status --short && ls -d .codegraph` | 2 | No codegraph index exists; normal source search used. |
| `rg ... testing/harness.tsx testing/seeds.ts testing/fake.ts` | 2 | Guessed fake.ts absent; located and read actual fakeApp.ts. |
| `rg ... testing/FakeApp.ts` | 2 | Case-sensitive filename mismatch; actual fakeApp.ts inspected. |
| `rg ... scenarios/workstreams.md` | 2 | Guessed plural path absent; actual workstream.md and workstream-queue.md inspected. |
| `cat apps/desktop/src/rail/move.ts` | 1 | Guessed module absent; actual MovePicker.tsx inspected. |
| `python3 /tmp/rail-observe.py` / exact menuitem Mode locator | 1 | Actual accessible name includes its chord. Snapshot ref selected Mode; New Mode dialog then independently captured. Earlier valid captures retained. |
| `rg ... crates/rup/src/mcp.rs crates/rup/src/cli/*.rs` for literal owner-only method names | 1 | No literal registrations there; shared annotations in crates/contracts/src/declarations.rs inspected. No absence inferred from the failed search. |
| `rg ... /tmp/rail-claude-help.txt` for slash-command names | 1 | Help does not list those built-ins. Official interactive reference is the source for them; help proves only the flags it actually prints. |
| Replacement of original FakeApp.showContextMenu after mount | 0, observer invalid | Decorated App retained its menu boundary; interception arrays stayed empty. Null values discarded; exact menu models independently recaptured using menuProbe without menu=1. This is not a successful interception claim. |

The remaining complete inventory, Q1 gaps, conditional states, dated direction and all-feature revision reconciliation stay on #5758. There is no owner ask or deletion permission. Older-Project successful reopening remains mandatory for any later retirement.

Additional command failures:

| Command | Exit | Failure / repair |
| --- | ---: | --- |
| `python3 tools/lint/scan.py rust` before setup | 2 | Dependency scan required the pinned cargo-deny binary. `just ready` installs it through the existing setup. This command was not a spelling scan. |
| `python3 tools/lint/scan.py web` first standalone run | 1 | Spelling scan rejected a misspelling in the copied #3194 owner quotation. Retained the linked source body hash and exact accepted-choice/outcome excerpt instead of copying unrelated original wording. No spelling exception or product change. |

Merged `origin/main` at `9f948f124` without conflicts; `git show --remerge-diff` has no resolution changes and `loop/rules.sh merge-loss` passes. Every inspected source hash remains identical to the audit pin. The full all-feature audit remains revision-unreconciled; this check covers only this slice's inspected paths.

| Further failed command | Exit | Failure / repair |
| --- | ---: | --- |
| `just ready` first run | 1 | Web lint/typecheck and N7 passed; repository spelling scan rejected the copied #3194 misspelling before the source excerpt repair. Rerun after repair; no product or lint-rule change. |
| Temporary aggregate report assertion (Python) | 1 | Counted decision ids again in the public-mapping table. Restricted counting to the independent-decision table; 22 rows, thirteen rendered openings, eight menu models and every inspected source hash then reconciled (exit 0). |

Final `just ready` passes (exit 0): B4522 migration guard, web lint/typecheck, repository and Rust lints, `ALL PROOFS CHECK` and N7 launch sites. Vocabulary, scenario ids, merge-loss, whitespace, all 33 inspected source hashes, eight exact menu models and thirteen rendered openings pass (exit 0). Own diff review is clean after correcting the existing `RailRow::NameField` reference and naming each applicable action id. No behavior tests changed; no local `just check` ran. The dedicated browser session was closed.

## Project entry continuation — builder-41583532350

Audited main `4dfcec6fd757600df568ecbe414e503d5d2af064`; own worktree `/tmp/roundup-u5741-41583532350`. The specification is merged and #5741 is closed. #5758's body was expanded with the exact documentary scope after `python3 loop/orders.py check /tmp/u5741-body.md` passed (exit 0), before edits. No product, scenario, test, contract or frozen-loop change; no policy-report wording test is added. No deletion, partial owner ask or Mac-only observation is requested.

Successful commands (exit 0): `git fetch origin main`; own branch/worktree creation; validated Issue edit; `pnpm install --frozen-lockfile`; `agent-browser skills get core`; installed `node_modules/.bin/claude --version` and `--help`; linked #1093 body/comments and #5741 state retrieval. `just harness tree-40 5227` subsequently served successfully (long-running observer, not a completed test).

Fresh dedicated headless session `u5741-project-415835`, profile `/tmp/u5741-project-profile-415835`, dark 1512×950. The observer saves the actual App appearance preference through existing preferences rather than editing DOM styling. The startup gate has no mounted App appearance; its system scheme follows the forced dark browser preference. Rendered evidence labels fake replies and native projections, retains Check failures if any, and makes no real process/clipboard/native chooser/durability claim. Current non-running-tab close and running-tab confirmation are different observations; the former must not be relabelled as a missing native question.

| Failed command / observer | Exit / status | Failure / disposition |
| --- | --- | --- |
| Initial `ls -d .codegraph .claude/sound` | 2 | No codegraph index; sound rules exist. Normal source search used. |
| `rg` against guessed harness/test/App paths | 2 | Actual harness is testing/harness.tsx and root App.tsx; both inspected. No absence inferred from guessed paths. |
| Reads of guessed `state/storageCopy.ts`, `settings/schema.ts`, `scenarios/ui-draft-continuity.md` | 2 | Actual owners are app/copy.ts, settings/preferences.ts and scenarios/unfinished-input.md, inspected. |
| `just harness tree-40 5227` before install finished | 254 | Vite was not linked yet; awaited successful pnpm install and relaunched. |
| Initial headless navigation to port 5227 | 1 | Connection refused before server startup; relaunched the existing isolated session after server became ready. Same fresh test profile, never personal Chrome. |
| First `/tmp/u5741-project-observe.py` | 1 | Environment assertion demanded literal dark while App used system `light dark`; no image retained. Explicit saved dark preference used for all App captures; startup gate uses forced dark media. |
| Premature rendered-project.json inspection | 1 | No manifest existed before the first successful capture; not a missing product observer. |
| Next `/tmp/u5741-project-observe.py` | 1 | Guessed nth-child tab-selection target did not reach the intended tab. Existing successful first five pages retained; exact data-path plus scroll reveal used in continuation. |
| `/tmp/u5741-project-continue.py` | 1 | Generic right-click did not reach the pointer-release menu path; actual mouse move/down/up opened the existing menu projection. Earlier valid captures retained. |
| `/tmp/u5741-project-rest.py` | 1 | Expected a running-Agent question on a tab with no running Agents; normal close succeeded. Captured that outcome separately, then opened agents-10 for the running confirmation. No confirmation failure inferred. |
| Apple canonical Recent Items page retrieval | unavailable | Full page could not be retrieved; search excerpt alone is insufficient. Its Q1 comparison remains unverified. |
| Literal public-rename lookup in keys/chords.ts | 1 | No such named tab action exists; focused F2 is a local binding in ProjectTab.tsx. Report corrected. |

The temporary observer drivers are retained as provenance in the source catalogue, not installed as product machinery. PNG files and Check readings remain under the checkout's `artifacts/ux/U5741/project/` for attachment; JSON report retains snapshots and evidence. Existing policy observers, not new source-text tests, judge U5741. B4522's unchanged migration guard is included by `just ready`. No local `just check` runs.

Final capture reconciliation: fifteen unique openings, each dark 1512×950, all recorded Checks pass. Visual inspection of tab draft recovery agrees with the retained exact authored name. Visual inspection of `reopen-failed.png` shows the cause shortened to `Cannot reopen Project. Check …` in the Rail's failure line while Reopen remains visible; automated Checks do not detect this missing full failure text. This is an unresolved rendered limitation, not a full failure-readability pass. Full cause bytes are retained in the snapshot/body. Final inventory reconciliation must resolve failure readability, not infer a passing visual observer from Check status alone.

Main `9c782fc17c78cb3c86dad633d5c84d646e2f58be` merged without conflicts; merge-loss passes (exit 0) and remerge-diff contains no manual resolution. The 33 inspected source hashes still match the observer pin. Main's new shared Menu code is outside that inspected list; rendered menu evidence stays pinned to its original revision. No all-feature revision promotion is claimed.

Additional failed source lookup: `rg ... crates/rupd/src/rpc/project.rs` exits 2 because no such module exists. The authoritative declarations and earlier endpoint census supply the public mapping; no runtime behavior or absence was inferred from the guessed path.

| Further failed command | Exit | Failure / repair |
| --- | ---: | --- |
| First `python3 tools/lint/scan.py typos` | 2 | Pinned spelling binary not installed; `python3 tools/lint/setup.py web` passed (exit 0). |
| Standalone spelling scans and first `just ready` | 1 | Generated accessibility labels split a clipped Project name into an apparent misspelling; report prose also used a plural abbreviation rejected by the scanner. Corrected prose; raw snapshots/body now retain exact original bytes in gzip/base64 with SHA-256 and documented decoding. Question and Checks stay plain JSON; no baseline, lint rule or observed string changed. |
| Temporary spelling-diagnostic extraction | 1 | Diagnostic lines carry a trailing location after JSON; repaired the temporary extractor with JSONDecoder.raw_decode. No product observer affected. |

Spelling repair completed: raw body text carries the same clipped fragments as the snapshot, so both are now losslessly encoded. Both are checksum-verified after decoding; fifteen captures and 21 decision rows reconcile, with 34 source hashes matching both original revision and current checkout. Final standalone spelling scan passes (exit 0). No captured byte, lint policy or baseline was changed. The initial 33-source statement above precedes inspection of the actual public handler in crates/agents/src/dispatch.rs; that added source is the 34th.

Final `just ready` passes (exit 0): B4522 migration guard, 193 lint-behavior checks, web lint/typecheck, repository and Rust lints, `ALL PROOFS CHECK` and N7 launch sites. Vocabulary, scenario ids, merge-loss, whitespace and final evidence reconciliation pass (exit 0). No behavior test file changed and no local `just check` ran. Own diff review resolved incorrect scenario/action references and separated missing-binary failure from optional executable diagnostics. The dedicated browser session is closed. #5758 stays open for complete coverage, one current revision, owner answers and authorized retirements.

## Rail structure continuation — builder-41586912445

Source main `4525b6ce563888c08b0b8bba3806449cf3b9c1f8`. Documentation only. RS01–RS19 (with RS17a/b/c) extend the reviewed inventory; R16 still owns error dismissal. No owner ask, answer or deletion is inferred. P1/P3/P6/P9/P11 gates preserve direct access, attention, Home, intentional work and drafts; rendered/action evidence is scoped to the fake seam, not production mutation.

Fresh isolated `agent-browser --session u5741-415869`, default headless, no personal profile or external browser connection; dark 1512×950, existing tree-40 harness on port 5231. Ten openings retain screenshots under `artifacts/ux/U5741/rail-structure/`. Raw accessibility snapshots are losslessly compressed to avoid spelling checks treating clipped labels as authored prose: `zlib.decompress(base64.b64decode(page['snapshotZlibBase64']))`, UTF-8; compare SHA-256 to `snapshotSha256`. Native menu models use the existing menuProbe in a separate nonprojected opening. No native appearance/launch/Message-delivery claim.

| Failed command / observer | Exit / status | Failure and disposition |
| --- | --- | --- |
| Initial `ls -d .codegraph .claude/sound` | 2 | No codegraph index; sound exists. Normal source search used. |
| `agent-browser skills get core && ls /tmp/*u5741* /tmp/*rail*` | 2 | Browser core read succeeded; no previous temporary drivers matched. Restored the reviewed driver from the checked-in source catalogue. |
| `cat .../emil-design-eng/references/accessibility.md` | 1 | Guessed reference absent; no observer claim depends on it. No UI code changed. |
| `agent-browser wait --text Quiet` in first structure driver | 1 | Timeout after 30000ms. Harness projects Alerts parent disabled rather than nested children; no submenu screenshot accepted. Exact production model read through existing native menuProbe. |
| Apple Finder folder guide open | HTTP 429 | Full page unavailable; search evidence alone retained; exact equivalence remains unverified. |
| Apple Open With guide open | HTTP 429 | Same limit; no configured-directory editor equivalence claimed. |

Successful source/render/hash reconciliation and final lint results are recorded below after completion. Every remaining vendor comparison, conditional opening, other App/endpoint decision and final all-feature revision reconciliation stays on #5758. No local `just check` or behavior-test suite ran; policy U5741 forbids report-text tests.

The first creator-Todo screenshot preceded loaded rows; it was superseded by a bounded `.todos-tab [data-todo]` wait and loaded capture. Source and screenshot show creator-matching reveal within owner groups, with other Todos still visible; no exclusive filter pass is claimed. Ten final openings pass every recorded Check; fake clipboard writes the exact `roundup://agent/tokens?project=project-0000000000000000`, and directory/editor boundaries receive `/Users/you/harness` (Project fallback, not a real Worktree observation).

| Additional command failure | Exit | Repair |
| --- | --- | --- |
| `python3 tools/lint/scan.py typos` before setup | 2 | Pinned binary absent in fresh worktree; `python3 tools/lint/setup.py web` installed the required tools. |

Self-review removed a duplicate error-dismissal row (R16 already owns it), separated Workstream bulk All/Default/Quiet into RS17a/b/c, corrected the creator reveal description and fixed the README table delimiter. The final inventory contains 21 unique decisions, ten unique rendered states, four exact native models and 36 inspected source hashes. All final Check readings pass. Error-seed labels are fixture evidence only; full actionable real-failure readability remains part of the unfinished audit.

| Further spelling scan failures | Exit | Repair |
| --- | --- | --- |
| Standalone `python3 tools/lint/scan.py typos` (two runs) | 1 each | Exact quoted Issue direction contained the historical plural image abbreviation. Retained its complete JSON losslessly as directionArchive (zlib/base64, decoded-byte SHA-256); readable direction findings stay in the report. No baseline or spelling exception changed. |

Decode the linked direction archive using the same zlib/base64 operation as snapshots, then JSON-decode. Its SHA-256 verifies the complete preserved Issue bodies/comments, including exact owner quotes.

| Required observer interrupted | Exit | Disposition |
| --- | --- | --- |
| First `just ready` | 143 | Process ended after desktop typecheck completed; output shows no preceding lint failure, but the Rust and N7 stages did not run. No complete pass claimed. Rerunning the required observer with retained log. |

| Observer execution repair | Exit | Disposition |
| --- | --- | --- |
| Second `just ready > /tmp/u5741-ready-2.log` | 143 | Run deliberately terminated after launching a detached observer, to keep the full required check independent of the interactive command lifetime. No pass inferred from the interrupted partial run. |

The final observer runs the unchanged `just ready` in a detached shell, retaining its complete log and explicit exit file; it changes no timeout, gate, recipe or test. The repeated partial lints are due to the interrupted observer, not added coverage.

Final detached `just ready` passes, exit 0: B4522 migration guard, web lint/styles/type checks, repository and Rust lints, `ALL PROOFS CHECK`, and N7 launch-sites. The complete log is `/tmp/u5741-ready-detached.log`; exit file `/tmp/u5741-ready-detached.exit` holds `0`. No local `just check` ran. No behavior test was authored or changed by this slice.

Main `d26af47b9e1fea792c4e7a9fd48f83070a3fdf9b` was merged without conflicts during validation; the source catalogue holds its exact resolved SHA and merge SHA. All 36 inspected sources still equal the audit pin. The final web source lint/type checks and repository/Rust/proof/N7 stages read the merged checkout; historical rendered evidence keeps its original pin. Vocabulary, scenario ids, whitespace, lossless snapshot/direction round trips, native alert models and merge-loss pass. Scope is six audit documents only; no image, video, product or frozen-loop file is committed. #5758 remains open for the unfinished inventory and later owner choices/retirements.


## Rail structure completion — builder-41588674845

PR #5859’s inherited evidence slice is verified against audited main `4525b6ce563888c08b0b8bba3806449cf3b9c1f8`: all 32 inspected source hashes match the checkout, all ten stored accessibility snapshots decode to their recorded SHA-256, and all ten environments are dark 1512×950. The independent-decision table contains 21 rows. No policy-report test was added.

Recreated all ten accepted openings with the recorded driver’s successful paths in dedicated headless session `fix5859`, fresh profile `/tmp/fix5859-profile`, isolated harness port 5233. Explicit App appearance is dark; every recorded Check passes. Fresh PNG files remain uncommitted under `artifacts/ux/U5741/rail-structure/`; fresh snapshots, Checks and command logs are retained there too. The known unavailable projected Alerts submenu was skipped; its full production model was reproduced separately: all four complete native menu models match the recorded models (exit 0). Screens establish reachability only: the creator control was captured before Todo rows loaded; the concurrent run’s loaded capture supersedes it and proves creator-based reveal within owner groups, not an exclusive filter. Rename and Move picker openings supply R12/R13’s pending rendered entry points, without establishing mutation or drag success.

| Failed command | Exit | Failure / disposition |
| --- | ---: | --- |
| `gh pr diff 5859 --stat` | 1 | This CLI has no stat option; used `git diff --stat origin/main...HEAD`. |
| `rg -n 'preferences' apps/desktop/src/testing/fakeApp.ts` | 1 | No match; inspected actual preferences storage in settings/preferences.ts and used saveAppSettings. |

The complete inventory, vendor comparisons, conditional states, final revision reconciliation and single owner request remain on #5758. No owner choice, retirement, product change or native effect is inferred.

Merged main `d26af47b9e1fea792c4e7a9fd48f83070a3fdf9b` without conflicts; remerge-diff is empty and merge-loss passes. Its test-only changes leave all 32 inspected sources unchanged; earlier rendered evidence remains pinned to its original revision.

| Failed command | Exit | Failure / repair |
| --- | ---: | --- |
| First `just ready` | 1 | Spelling scan rejected the plural image abbreviation in two copied direction comments. This run initially encoded only those two bodies with checksums; both decoded to the original bytes. The combined head retains the concurrent run’s complete directionArchive instead. No lint exception, baseline or product change. |

| Further failed command | Exit | Failure / repair |
| --- | ---: | --- |
| `python3 tools/lint/scan.py typos` (first standalone run) | 1 | Same plural abbreviation in the new validation paragraph; changed authored prose to PNG files. |
| `python3 tools/lint/scan.py web` (standalone run) | 1 | Same validation paragraph; source-comment encoding itself passed. |
| `python3 tools/lint/scan.py typos` (separate stderr diagnostic) | 1 | Reproduced that same validation paragraph diagnostic; repaired prose without changing observed bytes. |

Final `just ready` passes (exit 0) on the merged head: B4522 migration guard, 193 lint-behavior checks, web and package typechecks, repository/Rust lints, `ALL PROOFS CHECK` and N7 launch sites. Standalone spelling, vocabulary, scenario ids, merge-loss and whitespace checks pass. Source hashes, ten stored snapshot checksums, ten recreated openings and four complete menu models reconcile. Decoding the two archived direction comments reconstructs the entire inherited source catalogue exactly. Own diff review is clean; no behavior test changed and no local `just check` ran. The dedicated browser and harness are closed.

The push was rejected (exit 1) because the branch advanced to 30de64f7d. Merging that head stopped with content conflicts (exit 1); retained its complete source catalogue, direction archive and loaded Todo correction, plus this run’s independent validation. No product file or main-side line was dropped. Final post-merge checks follow below.

| Concurrent-head command result | Exit | Disposition |
| --- | ---: | --- |
| `git push origin HEAD:build/app-feature-audit-implementation` | 1 | Remote head advanced to 30de64f7d; fetched and integrated its corrections without force pushing. |
| `gh pr ready 5859` | 1 | Another run already marked the PR ready; verified ready state and enabled auto-merge. |
| `git merge origin/build/app-feature-audit-implementation` | 1 | Source catalogue and validation history conflicted. Kept the remote complete archive/loaded observation and both validation records; merge commit carries this run’s Author-Agent trailer. |

Combined evidence reconciliation passes: all 36 inspected source hashes, ten stored snapshot checksums and the complete direction archive’s decoded SHA-256. A second fresh headless profile and isolated port 5234 reproduce the loaded Todo opening after waiting for actual rows: all eight recorded Todo ids are visible, with creator-matching rows revealed in their owner group. The updated creator-todos PNG and loaded-completion-observations.json supersede this run’s earlier loading-state capture. Every recorded Check passes. The extra browser and harness are closed.

Post-integration `just ready` passes (exit 0), including all 193 lint-behavior checks, package typechecks, repository/Rust lints, `ALL PROOFS CHECK` and N7. Vocabulary, scenario ids, merge-loss and whitespace pass on the combined head. Self-review preserves the concurrent loaded-Todo correction and every main-side product/test change. No local `just check` ran.

## Terminal controls continuation — builder-41592285096

Main `20576d304c07acb4010a54c8ced66f1e86c255e8`: documentation only, no product/contract/scenario/test change. `terminals.md` records 31 controls and boundaries with three criteria, remaining unknowns and independent protocol work. Source catalogue pins 40 inspected files, exact linked direction and the losslessly archived observer driver. Decode archive fields with base64 then zlib and compare SHA-256. `rendered-terminals.json` retains twelve fresh isolated headless real-xterm/fake-Daemon openings; all recorded Checks pass at 1512×950 with explicit dark App mode. The observer reloads after setting dark mode so initial emulator Tokens are dark too. Initial captures from before that reload were superseded. Running/exited close confirmation payloads are observed at the App boundary, not rendered native dialogs. PNG files stay under `artifacts/ux/U5741/terminals/` uncommitted.

`pnpm install`, vocabulary, scenario ids, merge-loss, whitespace and evidence checks pass. The evidence check validates all source hashes, all three archive fields, twelve lossless accessibility snapshots, dark viewport and every recorded Check. No local `just check`, new behavior test, native outcome, real clipboard effect or older-data reopen is claimed. Full all-feature revision reconciliation and owner request remain unfinished; #5758 stays open.

| Failed command / observer | Exit | Failure / disposition |
| --- | ---: | --- |
| Initial `ls -d .codegraph` | 2 | No index; ordinary source search used. |
| `cat .../bubbles/close.ts` | 1 | Actual module is close.tsx; read before judging confirmation. |
| `sed .../testing/seeds/bubbles.ts` | 2 | Seeds are in testing/seeds.ts; inspected actual fixture. |
| `rg ... settings/schema.ts ...` | 2 | Guessed schema module absent; inspected preferences.ts and settings definitions. |
| Initial `python3 /tmp/u5741-terminal-observe.py` | 1 | Dark-mode assertion rejected guessed appearance preference; no capture accepted. Replaced with actual mode setting. |
| `rg ... crates/contracts/src/methods/*.rs` | 2 | Declarations are in declarations.rs and role filtering in rup/src/mcp.rs; inspected both. |
| Initial standalone `python3 tools/lint/scan.py typos` | 2 | Pinned tool absent in fresh worktree; existing setup installs it before rerun. |

The successful observer subsequently reloaded the App before selecting the Agent, reran all twelve openings and overwrote every previous capture and reading. Native text services, marked output, input/library variants, conditional failures and protocol comparisons remain engineering gaps; neither source-only evidence nor missing vendor parity is treated as a negative candidate answer.

The twelfth opening adds a chosen-Terminal close refusal on the eight-Run seed: full failure text and Retry remain visible, the tab stays, and all Checks pass. Its continuation driver is archived separately in terminal-source.json and uses the same isolated session. This establishes fake-seam readability, not a real Daemon outcome.

Final `just ready` passes (exit 0): B4522 migration filename guard, all 193 lint-behavior checks, styles, typechecks, repository/Rust lints, formal proof mutation checks (`ALL PROOFS CHECK`) and N7. Final evidence validation passes for all 40 source hashes, three archives and twelve dark viewport/snapshot/Check records, including the full dense close-refusal text. Main remains the audit pin; no merge or product delta occurred. Self-review restored the earlier changes/resource capture count accidentally touched by report wording replacement. Isolated browser and harness processes are closed; final media is also copied into the run checkout's artifacts path for workflow attachment. No local `just check` ran.


## Fix-run verification — builder-41594280547

Integrated remote head `c2ca0523e` by fast-forward; it had already made #5861 ready with auto-merge enabled. Independently verified all 40 pinned source hashes, three decoded archives and twelve stored snapshot hashes, dark viewport records and passing Checks. Replayed both archived observer drivers using a fresh isolated headless session against the unchanged App at the audit pin: all twelve openings pass every recorded Check, including readable dense close-refusal text and Retry. Recreated PNG files, Check readings and the replay manifest remain uncommitted under `artifacts/ux/U5741/terminals/`, also copied to the run checkout for attachment. Original checked-in observations remain unchanged. The isolated browser and harness are closed.

| Failed command | Exit | Failure / disposition |
| --- | ---: | --- |
| `ls artifacts/ux/U5741/terminals` | 2 | This fresh checkout lacked prior uncommitted media. Replayed the archived observer and recreated all twelve captures in an isolated session. |
| `python3 tools/lint/scan.py typos` (two attempts before setup completed) | 2 each | Pinned spelling tool was absent in the fresh worktree; the required ready recipe installs it before scanning. |
| `just ready` (first fix-run attempt) | 1 | Spelling rejected the plural image-format abbreviation in the new validation paragraph. Reworded it without changing evidence. |

`pnpm install`, vocabulary, scenario ids, merge-loss and whitespace checks pass. No product, contract, scenario or behavior test changed; #5758 remains open for the complete inventory and later owner request.

Final fix-run `just ready` passes (exit 0), including all 193 lint-behavior checks, styles, package typechecks, repository/Rust lints, B4522, `ALL PROOFS CHECK` and N7. The corrected standalone spelling scan also passes. No local `just check` ran.

## Requested attention, progress and Import — builder-41603063123

Documentation-only slice pinned to main `b021117d063f663008f9a692be5e7496b2eebbe1`. No product/scenario/contract/test/frozen-loop changes, owner request or deletion. `attention-import.md` records A01–A10, W01–W09 and I01–I15 separately. Source catalogue retains inspected hashes, exact direction replies, installed Claude 2.1.300 help, gh run view help and reproducible isolated driver. Current source public mappings are distinguished from earlier actual role offers; no fresh tools/list is claimed.

Observer: existing isolated App harness, fresh named browser/profile, headless Chromium, dark 1512×950. Fake Daemon openings prove webview controls and calls only. Captures remain uncommitted under `artifacts/ux/U5741/attention-import/`. Existing unavailable/error states are retained with Check readings; no native, real import/Message, clipboard or older-data reopening claim. Remaining conditional/equivalence/runtime/revision gaps remain on #5758.

| Failed command / observer | Exit | Failure and repair |
| --- | ---: | --- |
| Initial `pwd; git status --short; git rev-parse HEAD; ls .codegraph` | 2 | Optional index absent; ordinary source discovery used. |
| `cat ... importer/state.ts ... testing/fakeAppHandlers.ts` | 1 | Guessed modules absent; inspected rail/importState.ts and fakeApp.ts instead. |
| `rg ... app/commands.ts ...` | 2 | Guessed commands module absent; actual Rail/App/ProjectSettings registration read. |
| `rg ... app/App.tsx ...` | 2 | Actual App.tsx is at src root. |
| `rg ... settings/SettingsNav.tsx rail/ProjectTab.tsx ...` | 2 | Guessed modules absent; actual SettingsShell and header composition inspected. |
| first isolated driver, attention row activation | 1 | Used displayed login-store name as id. DOM gives logins; corrected selector, discarded earlier run and recaptured all openings after clearing test storage. |
| `rg ... contracts/src/methods/declarations.rs ...` | 2 | Actual declarations.rs is at contracts/src root. |
| direction search in existing direction.md | 1 | No matching Import/progress entry; fetched linked #3523/#3666/#4966 and read owning scenarios. |
| second isolated driver, unknown-resume wait | 1 | Expected phrase differs from current App text. Corrected wait to actual rendered status; all openings recaptured. |
| `cat crates/rup/src/cli/specs.rs` | 1 | Actual specs function is in cli.rs. |
| `rg ... crates/rup/src/cli/mod.rs` (two reads) | 2 each | Actual cli.rs read; verified command construction and kebab mapping. |

`pnpm install --frozen-lockfile`, work-order validation and Issue scope update passed (exit 0). Full lint and final source/render/archive reconciliation results follow below. No local `just check`; unchanged behavior files add no tests under U5741's policy observer.

| Additional command / observer | Exit | Failure and repair |
| --- | ---: | --- |
| `rg` over importState with an unescaped opening brace | 2 | Invalid regular expression; read the actual implementation block instead. |
| Python rendered-manifest inspection in the original checkout | 1 | New file belongs to the isolated worktree; reran there. |
| First `just ready` | 143 | Terminated during proof-command fixture checks, after web/Rust lints. No complete pass; reran detached with an explicit exit-code file. |
| `gh pr checks 5867` | 8 | Draft checks pending/skipped; no required-gate pass claimed. |
| Isolated `just harness import-candidates 5243` shutdown | 130 | Deliberately stopped this run's harness after all captures; browser session closed separately. |

Seventeen final openings retained: twelve Import/attention screens pass every recorded Check; five dense progress screens preserve D4's `li.progress-row` reading 41 initially and 42 after expansion and dependent D10 failure. Every D2/D5/D6 passes. The full-diagnostic screen opens the resume failure tooltip. Fake refusal/unknown replies exercise controls, not a production failure claim. All earlier failed driver runs are superseded, not combined with the final run.

Self-review corrected two observer limits before finalization: the fake seeded Import has no listing Agent, so the report distinguishes its source/revision refusal from the production branch adding a retained listing Agent. The final driver preserves the pointer on the diagnostic tooltip instead of moving it away before capture, and sets dark media as well as App dark appearance. The earlier tooltip capture is superseded.

The detached lint run records its final result independently of the interactive command lifetime. Only its explicit exit-code file establishes completion.

The final row review marks Q3 unverified for unrendered conditional variants (shell/comment attention, selected Copy, read/copy failures and Import conflict/storage recovery). Their implemented actions are recorded as source evidence; missing renders are not silently counted as negative criterion answers.

The final inventory separates read Retry from read-error Clear (W08/W09), yielding 34 independent rows. Error dismissal is optional to the five-stage result even where its owning scenario remains active; the rows no longer claim that a required retry/open outcome needs a separate dismissal control. This is candidate evidence only, not permission to remove one.

Final detached `just ready` passed (exit 0): all 193 lint-behavior checks, package typechecks, repository/Rust lints, formal proofs (`ALL PROOFS CHECK`) and N7's launch-site observer. Final source/archive/snapshot reconciliation, dark media/appearance/viewport checks, D2/D5/D6, vocabulary, scenario ids, merge-loss, spelling and whitespace checks passed (exit 0). No local `just check` or added/changed behavior tests. Browser session and only this run's harness are closed. All seventeen final PNG files are also copied to the workflow checkout's `artifacts/ux/U5741/attention-import/` for attachment; none is committed.


## Independent fix-run verification — builder-41604993438

Integrated the original builder's concurrent head `840a525bb0fcb01dd0a9be9cde2a12c55e541b90` by fast-forward, retaining its 34 rows, conditional observer limits, source/refusal distinction and corrected archived driver. Main remains the audited `b021117d063f663008f9a692be5e7496b2eebbe1`; no merge resolution or product change was needed.

Independently verified all 34 source hashes, every archived payload and all seventeen stored snapshot checksums. Replayed the updated driver in a fresh headless profile/session on isolated port 5247: all seventeen openings reproduce the recorded Check statuses, with dark media and App appearance at 1512×950. Visually inspected the final diagnostic PNG: the full cause and recovery stay visible. Corrected the report's D4 reading to 41 initially and 42 after expanding earlier versions; the underlying observations are unchanged. Captures and the independent manifest remain uncommitted under the workflow checkout's `artifacts/ux/U5741/attention-import/`.

| Command / observer | Exit | Disposition |
| --- | ---: | --- |
| `just harness import-candidates 5247` shutdown | 130 | Deliberately stopped only this run's harness after observation; its dedicated browser closed successfully. |

Independent `pnpm install --frozen-lockfile` and `just ready` pass (exit 0), including all 193 lint-behavior checks, package typechecks, repository/Rust lints, B4522, `ALL PROOFS CHECK` and N7. Final spelling, vocabulary, scenario ids, merge-loss and whitespace checks pass. No local `just check` or changed behavior tests. #5758 remains open for the documented inventory gaps, owner choices and authorized retirements; older-Project reopening remains mandatory.

## Shelf evidence — builder-41608283605

Source: main `eaa391d9d2f9eb7d9aaeb874590ec20e4ad805a8`, own worktree `/tmp/roundup-41608283605`. Scope expansion validated with `python3 loop/orders.py check /tmp/u5741-body.md` (0) before writing #5758. No `.codegraph/` index exists; ordinary source search used. Read installed dependencies/platform and existing Shelf/Ark/receipt implementations; no library, machinery or product code added. No scenario or test changes; U5741 clauses are policy observers.

The source catalogue retains inspected hashes, four full direction Issue records, public mappings and the exact isolated observer. Historical actual CLI/MCP replies retain their original revision; no fresh both-role runtime claim is made. Source-only and unverified comparisons remain listed in shelf.md. Documentation changes move no product Check; each accepted opening records all Check results. No local `just check`, deletion or owner choice is inferred. P3/P6/P11/P12 gates have no changed product path; later retirements still require their behavioral observers and successful older-Project reopening.

| Failed command / observer | Exit / status | Failure and disposition |
| --- | --- | --- |
| `cat apps/desktop/src/app/ShelfFrame.tsx` | 1 | Guessed module absent; read actual shelf/frame.ts and app/Layout.tsx. |
| `cat apps/desktop/src/shelf/history.ts` | 1 | No such module; read App history registration and todos/deleteTodos.ts. |
| `rg ... apps/desktop/src/keys/history.ts ...` | 2 | Guessed path absent; App.tsx and keys/focus.ts own scoped history. |
| `sed ... apps/desktop/src/todos/undo.ts` | 2 | Guessed path absent; actual deleteTodos.ts inspected. |
| `rg --files apps/desktop/src/drafts` | 2 | Directory absent; existing state/connectedProject.ts owns drafts/undo. |
| `cat scenarios/ui-shelf-scope.md` / later `rg` including same path | 1 / 2 | Scope acceptance is U2744a in ui-shelf.md; actual file inspected. |
| `rg` including testing/harness.ts and testing/fake.ts | 2 | Actual harness.tsx and fakeApp.ts inspected. |
| `sed ... apps/desktop/src/pads/groups.ts` | 2 | Actual padGroups is in shownPads.ts; source/citations corrected. |
| `sed ... apps/desktop/src/pads/padGroups.ts` | 2 | Same mistaken path; inspected actual shownPads.ts. |
| First `just harness tree-40 5251` | 254 | Install had not finished; Vite unavailable. pnpm install completed (0), relaunched successfully. |
| Initial driver `wait .todo-row-button` | 1 | Omitted explicit harness items opening; discarded and corrected query. |
| Second driver `wait .todo-row-button` | 1 | Unassigned group folded; discarded and disclosed actual group before capture. |
| Dense Maximise `wait --fn ...shelfMaximised` | 1 | State timed out after activation; no maximization pass claimed. |
| Reduced-motion Maximise `wait --fn ...shelfMaximised` | 1 | Same failed observer; omitted this unresolved branch from successful replay. |
| Driver click `#shelf-tab-pads` after Close | 1 | Closed panel unmounts its tabs in this harness; reopen through actual leader B. |
| Driver return to Todos `wait .todo-row-button` | 1 | Remounted owner group folded; disclose before waiting for rows. |
| Driver initial group click | 1 | Group not loaded yet; bounded group-control wait replaces premature click. |
| Apple selection-guide direct retrieval | HTTP 429 | Search excerpt is not a full equivalence proof; exact comparison stays unverified. |

The timed-out maximization probes do not establish a product cause. The final replay uses reduced motion and no timing claim. Repeated captures supersede earlier failed attempts; images remain uncommitted for workflow attachment. Continue the explicit worklist before the final all-candidate request.

Additional failed observers: `ls artifacts/ux/U5741/shelf` from the original checkout (2), rerun in the owning worktree; initial Pad post-delete zero-row wait (1), because retained root Pads become visible after the selected group disappears, corrected to selected-set/count observation; Pad Redo count wait (1), because the existing fake store does not implement pad.redoDelete, now recorded as unavailable rather than fabricated success. A diagnostic eval accidentally requested the focused body HTML and produced oversized output (0); subsequent reads select only ids, counters and bounded text.

The initial attached `just ready` ended with process exit 143 despite its log reaching successful B4522, web/type checks, repository/Rust lints, all 193 lint-behavior checks, `ALL PROOFS CHECK` and N7. That is not a complete pass. A detached repeat with a persistent explicit exit-code file supplies the final observer below. Standalone spelling passes (0).

Final evidence integrity: 41 inspected source hashes, twelve dark 1512×950 openings, every recorded Check, all four direction archives, exact observer archive and twelve accessibility-snapshot hashes pass. Each image has a recorded SHA-256. The full first deletion diagnostic is visible in delete-full-diagnostic; other target diagnostics remain independently inspectable, not all simultaneously visible. No positive Pad Redo observer is claimed: the fake-store method-not-found is retained in pads-redo-unavailable. PNG files are uncommitted.

The first detached repeat ended before completion without an exit file; no pass is inferred. A live PTY repeat preserves explicit status. The initial exit-file read failed (1) because its process had ended without writing it. Final required-command status follows after completion.



Isolated browser closed successfully (0); this run's harness session ended by SIGTERM (143) after captures, with no native browser fallback. Twelve accepted PNG files were copied to the workflow checkout under artifacts/ux/U5741/shelf/ for attachment. Source and observer archives are lossless; no image/video is committed. Self-review checked duplicate decisions, code/user-label naming, placement, every claimed capture and the explicit failed/unavailable branches. Main remains the audited eaa391d9d revision after the final fetch; no merge resolution was needed.

Final `just ready` live PTY repeat: exit **0**, confirmed both by the completed process and /tmp/u5741-ready-live.exit. B4522 migration guard, all 193 lint-behavior checks, package type checks, repository/Rust lints, formal proofs and N7 pass. Final vocabulary, scenario ids, merge-loss, spelling and whitespace pass. No behavior test changed or local just check ran; CI judges the implementation head. This evidence slice is complete; the full U5741 inventory, vendor/conditional reconciliation and owner request remain unfinished on #5758.


## Shelf fix-run evidence — builder-41609532898

Independently observed the Shelf on PR #5868 as a documentation-only evidence slice pinned to main `eaa391d9d2f9eb7d9aaeb874590ec20e4ad805a8`. The concurrent head 1454b5428 supplies 26 S-prefixed decision rows. This integration retains them and separates per-target dismissal, uncertain-operation dismissal and width reset as S27–S29, and preserves the independently observed completed-Todo fold as S30; they can have different keep/delete choices. The preliminary SH-prefixed table was superseded when integrating that head. Every row distinguishes its three criteria; all vendor-equivalence comparisons and unrendered conditional branches remain explicitly unverified. No product, contract, scenario, behavior test or frozen-loop change. #5758 stays open for the complete inventory, owner choices and authorized retirements.

Observed through the existing fake-Daemon harness in an isolated worktree and a fresh dedicated headless Chromium profile/session, at 1512×950 with dark media and App appearance. Source hashes, complete #4966/#4533 direction replies and the compressed reproducible driver are in `catalogues/shelf-followup-source.json`. `rendered-shelf-followup.json` retains snapshots, call payloads, local storage and Check readings. Media stays uncommitted under `artifacts/ux/U5741/shelf-followup/`; it proves webview actions only, never native menus, actual store mutation or older-Project reopening.

| Failed command / observer | Exit | Failure and repair |
| --- | ---: | --- |
| `rg` including `scenarios/ui-shelf-selection.md` | 2 | Guessed scenario path absent; read ui-shelf-delete.md instead. |
| `rg` over `todos/deletion*.ts*` | 2 | Guessed module absent; actual deletion implementation is todos/deleteTodos.ts. |
| `rg` including `state/unfinishedWork.ts` | 2 | Guessed path absent; connectedProject.ts identifies createTodoUndo in deleteTodos.ts. |
| First isolated driver, `.todo-row-button` wait | 143 | Stopped the driver and its wait: initial Unassigned group is folded. Wait for mounted scope and explicitly unfold it. No capture accepted. |
| Second isolated driver, all-animation settle | 143 | Stopped driver and evaluator: indefinite Terminal cursor animation never finishes. Existing Shelf observer filters relevant surface animations; adopted that filter. No capture accepted. |
| Third isolated driver, exact Restore button | 1 | Unscoped Maximise matched a centre control; repaired to .shelf-controls and explicit maximised-state waits. Superseded captures discarded. |
| Fourth isolated driver, `[data-id="auth-refactor"]` | 1 | Display name is not identity; inspected DOM and used auth/tokens ids. Superseded captures discarded. |
| Fifth isolated driver, exact Overview Project root button | 1 | Accessible name also includes current attention counts. Use its stable todo-project-root selector. Superseded captures discarded. |
| Sixth isolated driver, closed tab click | 1 | Closed layout does not expose that trigger for this state. Reopen through the existing ⌘K B action; final replay supersedes the partial manifest. |

`pnpm install --frozen-lockfile` passed. No test file changed; U5741's policy observer requires evidence rather than tests of report wording. Required lint and final evidence reconciliation results follow below. No local `just check` ran.

| Additional failed command | Exit | Disposition |
| --- | ---: | --- |
| Mid-replay manifest inspection for delete-failed | 1 | The new manifest had not reached that opening yet; inspected only the complete final record afterward. |

Final replay retains nineteen openings, each passing every recorded Check, including D2/D5/D6. Visually inspected the deletion-failure image: the cause, original-work guidance and originating recovery controls remain visible. The refusal is an injected fake reply; no real storage failure is asserted. All source hashes match the pinned main bytes; archived driver/snapshot checksums, dark media/appearance, viewport, successful command records and image presence reconcile. All nineteen media files are copied to the workflow checkout for attachment, without committing images.

The final observer additionally exercises keyboard resize and Enter width reset, bringing the total to nineteen passing openings, including S07 resizing and S29 width reset. Pointer resize and double-click reset remain explicit source-only branches. `just ready` passed (exit 0), including all 193 lint-behavior checks, styles, package typechecks, repository/Rust lints, B4522, `ALL PROOFS CHECK` and N7. Final spelling, vocabulary, scenario ids, merge-loss and whitespace checks pass. No local `just check` or added/changed behavior tests.


| Integration / shutdown command | Exit | Disposition |
| --- | ---: | --- |
| `just harness tree-40 5251` shutdown | 1 (Vite 143) | Deliberately terminated only this run's harness after final observation; dedicated browser closed successfully. |
| `git push origin HEAD:build/app-feature-audit-implementation` | 1 | Remote advanced concurrently to 1454b5428; fetched and integrated it without force. |
| `git merge --no-commit origin/build/app-feature-audit-implementation` | 1 | Expected documentary conflicts; retained the concurrent canonical report/catalogues and all original evidence, moving independent observations into distinct follow-up archives. |

The follow-up media has its own shelf-followup directory to avoid replacing the original run's captures. Its exact executed driver retains the original output names; the bootstrap documents the archival rename. Source hashes/snapshot bytes and observation values are unchanged. The combined head receives another required lint pass below.

The integrated public mapping uses exact MCP spellings `pad_getDeletion` and `pad_redoDelete`: `crates/rup/src/mcp.rs::tool_name` preserves camelCase outside github methods. CLI verbs still use kebab-case in cli.rs. This corrects source-map spelling, without claiming fresh tools/list replies.

The second concurrent advance only appended its completed validation/cleanup record (911bc66ef and 046f897f6); both paragraphs are retained. Its merge returned 1 for a validation-footer conflict, resolved by keeping both records. No product file or baseline source changed.

`loop/rules.sh merge-loss` initially returned 1 because the two follow-up files first appeared through a merge commit. A normal own commit now records useful image SHA-256 values and the explicit driver-to-archive path mapping in those files; no evidence is discarded. Final merge-loss is checked again before push.

Combined-head verification after both concurrent integrations: `just ready` completed with exit 0, including all 193 lint-behavior checks, package typechecks, repository/Rust lints, B4522, formal proofs (`ALL PROOFS CHECK`) and N7. Both source catalogues (41 and 38 entries), both exact observer archives, all 31 snapshots and every recorded Check set verify. The nineteen independent image hashes match the retained media. Final standalone spelling, vocabulary, scenario ids, merge-loss and whitespace pass. The scope addition for the two follow-up evidence files was validated with loop/orders.py (0) and recorded on #5758. No behavior tests changed and no local just check ran.
