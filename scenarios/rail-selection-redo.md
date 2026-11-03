# Rail selection Redo preserves newly added work

Module: crates/rupd; U5829a, U5829b.

Acceptance for [#5829](https://github.com/roundup-app/roundup/issues/5829), extending U5690d in `scenarios/ui-rail-selection-actions.md`. Tests marked planned belong to implementation; this specification changes no runtime behavior.

## Boundaries

Policy: apply the existing U3787a arrival rule to every Workstream removed by one retained Rail selection. Redo removes the captured Rail identities and the originally authorized work, never work added after Undo. Surviving Todos and Pads whose Home is removed become Project-scoped (`home: null`); the next Undo can restore their original Home. Selection removal keeps its default scope, one retained operation and one history step. This adds no confirmation, command, history store or wider cascade.

**U5829a Redo clears arrivals' Homes in every removed Workstream.** Given two empty Workstreams A and B removed as one reversible selection and then restored through its retained operation, when the user creates a Todo and Pad in each restored Workstream and redoes that selection removal, then both Workstreams are absent from `rail.tree`, all four arrivals remain readable with `home: null`, and their Todo identities, titles, completion and blocker edges and Pad incarnation, text and Revision match their pre-Redo values. Exercise both open and completed arrival Todos: becoming done after Undo does not add a Todo to the original deletion set. Planned real-Daemon test: `u5829a_selection_redo_preserves_arrivals_in_every_removed_home` in `crates/rupd/src/removal/redo_tests.rs`, table-driven over those completion states and with distinct Pad text and Todo titles per Home. Read back through `todo.get` and `pad.read`; checking only the receipt or the first selected Workstream is insufficient.

Given the same sequence with an unselected surviving Workstream C holding a Todo and Pad, and a Project-scoped Todo and Pad, when Redo succeeds, then those unselected items retain their exact identities, Home, contents, completion, blocker edges and Pad incarnation/Revision. Planned test: the same `u5829a_selection_redo_preserves_arrivals_in_every_removed_home`, comparing before/after public readbacks for C and Project-scoped controls. Retain the two-Workstream case without C as a table row, so the reported empty-Rail result is also exercised.

**U5829b Undo restores each arrival to its own Workstream after Redo.** Given U5829a's successful Redo, when the user restores that Redo's retained operation, then A and B return with their original identities, order and relationships, each arrival returns to its own pre-Redo Home, and its identity and content remain unchanged. Planned real-Daemon test: `u5829b_selection_redo_undo_restores_each_arrival_home` in `crates/rupd/src/removal/redo_tests.rs`. Use distinct arrivals for both Homes and assert each exact Home rather than membership in either restored Workstream.

Given that restored operation, when another Redo and Undo cycle completes using the acknowledged restoration identity and a fresh operation key, then the same arrivals again survive Redo with null Homes and return to their respective original Homes on Undo. Planned test: the same `u5829b_selection_redo_undo_restores_each_arrival_home`, comparing public readbacks after each transition. Existing Check 2 retains acknowledged-request replay and Touch-count coverage; do not duplicate that proof. Neither cycle starts an Agent or Terminal, observed through the existing real-Daemon launch/Terminal probes in that test.

## Gates and observers

Policy: P6's gate asks whether Redo leaves an item assigned to a removed Home or changes unchosen work; observe exact Rail membership and Todo/Pad Home/content readbacks after each transition. P9's gate asks whether Undo/Redo starts a program; retain zero-launch/Terminal observations. Existing explicit user Home moves continue to win under U3787a; this specification does not authorize replacing a newer placement.

Checks retained on main:

| Check | Existing holder on main | Required observation |
| --- | --- | --- |
| 1 | `scenarios/ui-rail-selection-actions.md`, **U5690d** | One reversible selection remains one retained Undo/Redo operation with default removal scopes. |
| 2 | `crates/rupd/src/removal/redo_tests.rs`, `u3787a_rail_redo_preserves_arrivals_and_restores_exact_participants` | Preserve single-target arrivals and the original authorized deletion set; do not replace this proof with receipt-only checks. |
| 3 | `crates/rupd/src/removal/redo_tests.rs`, `u3787a_rail_redo_refuses_changed_placement_without_mutation_and_retries` | Keep changed-placement refusal atomic and retryable. |
| 4 | `crates/rupd/src/removal/restoration_tests.rs`, `u3787a_workstream_cascade_restores_pads_blockers_and_homes` | Keep existing Todo graph, Pad and Home restoration. |

Policy: use the existing in-process real Daemon and public RPC dispatch seam; no mock participant receipts, new browser/process observer or native Mac observation is required. This is an Intervene/Review data-integrity repair, with no rendered surface, Token, copy or motion change and no moved visual Check. Existing selection UI acceptance stays with U5690d.

## Implementation scope and verification

Policy: repair the existing Todo and Pad deletion participants in `crates/todos/src/deletion.rs` and `crates/pads/src/deletion.rs`, coordinated by `crates/rupd/src/removal.rs`; add the planned proofs in its existing `removal/redo_tests.rs` test module. Inspect the retained selection representation in `crates/agents/src/rail/removal.rs` before choosing the query; reuse owning transactions and receipts. No storage migration or public contract change is ordered. Any reached owner/caller expansion and engineering prerequisite belongs on #5829, not in a scenario Work table.

Policy: implementation first commits a failing public-RPC regression for the second selected Home, then repairs both participants. Run `just ready` and the targeted `rupd` tests for U5829a, U5829b and Checks 2–4 with `cargo nextest run -p rupd <test names>`; CI judges other tests. Do not run a whole suite or `just check`. Record failures and repairs on the Issue as one row per failed command with its exit code. Before adding machinery, inspect installed rusqlite/SQLite transactions and existing retained-selection facilities and satisfy rule 9 if needed.
