# UI: inside an item the main change comes first, and each flow or module carries a risk mark with its reason (U7697a–U7697f)

Module: `apps/desktop/src/changes/` (the ordering inside an item, the mark, the reason), the fake App and its fixtures. Ids: U7697a, U7697b, U7697c, U7697d, U7697e, U7697f. Work order: [#7697](https://github.com/roundup-app/roundup/issues/7697), blocked by #7689 (merged) and RB10 to RB12 (`scenarios/readback-rank.md`). Owner, 2026-11-18, from the Plannotator audit: "Core first, glue last" and "Risk marks"; "it shouldn't be the same agent it should be a readback"; "I care about flows/paths/modules and mental models". The owner's two decisions hold as written: inside a Module, a Logic item or a Tests item the main change comes first, then what it forces, then glue; and each flow or module carries a risk mark of high, medium or low whose reason shows on hover. A flow keeps call order (#7683). Owner, 2026-11-26: every action is an icon, no text button.

**Precedence.** A design check (the critic, a D-check) that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**Words.** The quoted words below are asserted through `copy.ts`, never layout or looks (rule 10). A **rank** and a **risk** are the Account's `ranks` and `risks` (RB10, RB11); the App writes ranks as "Core", "Forced" and "Glue", and a risk's level as "High risk" and "Medium risk" (the mark's accessible name).

**Fixture.** The lens fixture (U7679) on the Tree target with a fake `agent.readback` whose Account ranks `crates/a/src/x.rs#1` glue and `#2` core, `crates/a/tests/x.rs#1` glue and `#2` forced, and gives `crates/a` risk high ("Changes what the rail counts as owned."), `crates/b` medium, `crates/c` low, flow `code-1` high and `added-1` low (U7689 fixture).

**Decided here.** `agent.compareFile` and the diff reader count hunks differently from a hunk id (U7689b: only the id's path is sound), so the App cannot place hunk `n`. The order is at the grain of the file: a file's rank is the best rank any of its hunks holds (`core` before `forced` before `glue`), and inside a module, a Logic item or a Tests item the files sort by that rank, then by path (U7678c's order), stably. A file of no ranked hunk sorts last among its peers. A Module's tests still follow its logic (#7678 decision 2): the rank orders within the logic files and within the test files, never across them. A rank row's words, "Core", "Forced" or "Glue", sit in each file's header only while the rank order is in force.

**U7697a with a readback, an item's files follow rank order.** Given a `read` readback, then:
- **Order.** In a module's scroll, in the Logic lens and in the Tests lens, the files of one kind follow their rank (core, forced, glue) and then path order, and the module's tests still follow its logic. With the fixture `crates/a`'s logic file `x.rs` (best rank core) sorts before a logic file `a.rs` of glue only, though path order puts `a.rs` first. Asserted in `u7697a_a_readback_orders_an_items_files_core_then_forced_then_glue_and_tests_follow_logic`.
- **Flows.** A flow's sections keep call order whatever the ranks. Asserted in `u7697a_a_flow_keeps_call_order_whatever_the_ranks`.
- **Keeps.** The list's rows, the keys' order across files (U7678d), Viewed marks and notes work on the ranked order as on path order. Asserted in `u7697a_keys_and_viewed_follow_the_ranked_order`.

**U7697b without a readback the order and marks are as before.** My reading, kept: given no readback (not read, reading, failed), the order is U7678c's (logic then tests, path order; a flow's call order) and no mark shows; a result with no rank for a path's hunks leaves that path in path order. Asserted in `u7697b_without_a_readback_the_order_is_path_order_and_no_mark_shows`.

**U7697c high and medium draw one small mark, low draws none.** Given a `read` readback, then:
- **Mark.** A high or medium module row, a flow's row and the item's own header show one small mark named "High risk" or "Medium risk"; a low one shows nothing and no placeholder. Asserted in `u7697c_high_and_medium_draw_one_mark_and_low_draws_none`.
- **No words in the row.** The reason is not drawn in the row; the mark is no number and no score (P14). Asserted in the same test.
- **Where.** The risk of a module sits on its row and its Overview line, a flow's on its row, its Overview line and its header, an added flow's included. Asserted in `u7697c_a_marks_sit_on_the_row_and_the_overview_line_of_its_module_or_flow`.
- **Stays.** A mark never changes a row's count, a Viewed mark or what Landing allows (a personal aid, never a gate). Asserted in the same test.

**U7697d the reason shows on hover and on keyboard focus.** Given a marked row, then hovering the mark, and focusing it from the keyboard, opens a tooltip (U510's `@ark-ui/solid` tooltip, the same primitive) that reads the one-sentence reason and "Read back from the diff"; leaving or Escape closes it. A reason the readback did not give is no state: RB11 refuses that result. Asserted in `u7697d_hover_and_focus_show_the_reason_credited_to_the_readback`.

**U7697e a write dims the marks and the order stays.** My reading, kept: when the Daemon answers `stale` (RB7) the marks stay, dimmed, their tooltip adding "Changed since the readback" (U7688b), and the order stays as ranked; a new start replaces both (U7688a). Asserted in `u7697e_a_stale_readback_dims_the_marks_and_keeps_the_order`.

**U7697f the rendered marks and order at 1512 by 950.** Given the U26 harness, dark App, on the 14-module fixture with the fake `agent.readback` ranks and risks, then a high mark, a medium mark and a reason tooltip draw. D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U7697f`; evidence under `artifacts/ux/U7697f/`, uncommitted. Policy; the design critic judges layout and looks, never a Vitest test (rule 10).

**Amended.** U7678c's "One scroll, logic first" (the order within the logic files and within the test files follows a readback's ranks, U7697a); U7688d, U7683c and U7689a's item rows (the mark, U7697c); RB3 (`scenarios/readback.md`: the Account carries `ranks` and `risks`, RB10 and RB11). Kept: a flow's call order, notes, Viewed, the repeats and the lenses as built.

Not wanted: a score, number, cost, token or usage word (P14); a rank or risk guessed from a file name or size; a Landing gate; a start without the user (P9); a Model control (U377); Plannotator (plannotator.ai) as the review surface, rejected by the owner, 2026-11-18. No test of layout or looks.

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/readback.md`, RB3 and RB7: the Account this extends and its staleness.
2. `scenarios/ui-changes-modules.md`, U7678c: the order this refines.
3. `scenarios/ui-changes-readback-flows.md`, U7689b: why order is at the file's grain.
4. `scenarios/ui-buttons.md`, U510: the tooltip primitive.
5. `crates/contracts/src/agent/readback.rs`: `Account`.
