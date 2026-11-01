# Retire completed documentation and describe the current architecture

Work order: #5465. Ids: N5465a, N5465b, N5465c. Acceptance only; implementation follows this specification on main.

Scope: the retired entries below, `docs/architecture.md`, `docs/adr/0009-app-component-layer.md`, and citations in existing documentation and scenarios. `tools/lint/debt.json` may lose only entries made obsolete by these removals or citation edits. No runtime, contract, glossary, proof, test or loop change is required. Performance documentation remains with #5455; the U478 documentation remains with #5464.

## Retired entries

Join each parent and entry with `/` to obtain the repository-relative path. Keeping the components separate lets the specification itself satisfy the no-reference observer after deletion.

| Parent | Entry | Extent |
|---|---|---|
| `docs/observations` | `a35-linux` | Entire directory |
| `docs/observations` | `e3-workstream` | Entire directory |
| `docs` | `lint-suite-evidence.md` | File |
| `docs` | `native-drag-compatibility.md` | File |
| `docs/adr` | `0010-core-scope-and-messages.md` | File |

**N5465a completed records leave no dangling references.** Given the retired entries above, when the documentation cleanup lands, then:

- No tracked file remains at a retired file path or beneath a retired directory (policy: `git ls-files -- <path>` has empty output for each assembled path).
- No tracked file contains any assembled retired path, including a directory path without its trailing slash (policy: for each path, `git grep -n -F -- <path>` has empty output and exit 1; exit 0 is a remaining reference, and any other exit is an unavailable observer).
- Existing citations are removed or replaced with existing acceptance or implementation sources. `scenarios/dependencies.md` keeps Z4503's spike retirement and lint-baseline requirements without requiring edits to a deleted report. `scenarios/workstream-clear.md` retains the Clear/Handoff retirement requirements in its own acceptance, and `scenarios/resources.md` retains selected-Agent inspection and the Daemon totals contract. Neither asks a later implementation to update the retired assessment. Shorthand references to that assessment in other scenarios also point to the applicable existing acceptance, without changing their product requirements (policy: review citation edits against Checks 1–3).
- `tools/lint/debt.json` drops obsolete entries for deleted or edited text without adding or enlarging another allowance (policy: baseline diff and existing lint observer, Check 6).

**N5465b the component decision distinguishes direction from delivered work.** Given the accepted App component direction, when its status is refreshed, then the pending statement for U474, U475 and U473 is removed if their implementations and required validation have landed. Verify the current wrappers, CloseDialog caller, tests and merged evidence against those three clauses; if any remains pending, name that remaining validation accurately instead of claiming completion. Keep the accepted Ark direction and remaining migration boundaries (policy: compare the ADR's status and migration prose against Check 4 and merged implementation evidence; no new dependency research or component change).

**N5465c architecture describes the checkout.** Given `docs/architecture.md`, when a contributor uses it to locate modules and understand their contracts, then:

- Its Layout includes `crates/messages`, `crates/native` and `crates/perf`. Every crate/path, type, method and field named anywhere in the document exists on the implementation head; each description agrees with its declaration and callers (policy: inspect Layout and resolve every code name against the checkout, Checks 5 and 7).
- The adapter description agrees with `AgentAdapter` and `Observation`, including `observe`, `has_hook_signal` and the current observation variants. It attributes launching to the actual launch implementation rather than an adapter `spawn` method. No `AgentHandle`, `AdapterKind`, `readBy` or `touchedBy` is presented as an existing type or field (policy: declaration comparison, Check 5).
- The Data and Message delivery sections describe the current stores, Message fields, Routes and inbox delivery, with no obsolete prompt-submit injection account. Documentation correction changes no delivery behavior, law or contract (policy: compare against Check 7 and existing Message acceptance).
- The typos lint passes on the implementation head (policy: `python3 tools/lint/scan.py typos` exits 0, Check 6). No new text-matching test is required for this documentation cleanup.

## Checks on main

These numbered sources identify the existing acceptance and observers; they do not claim the cleanup has passed.

1. `scenarios/dependencies.md`, heading **Z4503 security overrides and retired spike**, and `tools/lint/debt.json`, field `typos`: preserve spike retirement and removal of obsolete allowances.
2. `scenarios/workstream-clear.md`, heading **Gates and regression observers**: retain the removal's gates and ordinary Message guarantees when trimming the assessment citation.
3. `scenarios/resources.md`, headings **D8 the Daemon samples an Agent's Resource use when asked** and **U408 the Resource strip shows the selected Agent's use**, plus its opening policy amendment: retain the Daemon totals contract and explicitly requested selected-Agent inspection.
4. `scenarios/ui-buttons.md`, headings **U474 the App reuses component behaviour**, **U475 CloseDialog uses AlertDialog** and **U473 the component dependency keeps the budgets**: distinguish adoption from remaining validation before changing the ADR's status.
5. `crates/agents/src/lib.rs`, `AgentAdapter` and `Observation`: compare the documented trait and variants with their declarations and launch callers.
6. `tools/lint/scan.py`, `inventory`, `compare` and `main`: run the existing `typos` section, which rejects new diagnostics and obsolete baseline entries.
7. `Cargo.toml`, workspace `members`; `crates/contracts/src/message.rs`, `Message` and `Route`; `scenarios/messages.md`, heading **B2 auto delivery**; and `docs/architecture.md`, headings **Layout**, **Data** and **Message delivery**: resolve the documented module and delivery claims to current declarations and implementation.

## Observer results

Policy: record the implementation head and command results on the work Issue. Record one row per failing command with the exact command, exit code and cause. For the path greps, exit 1 with empty output is success; record actual unexpected exits. Declaration comparisons name the source declaration for each corrected architecture claim. An unavailable tool or missing evidence is recorded as unavailable, never as a pass. This documentation-only change has no rendered surface or Mac-only observation and changes no product gate.
