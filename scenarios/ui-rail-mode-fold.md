# UI: a Mode folds like a Workstream (U7594a)

Module: `apps/desktop/src/rail/` (the webview). Id: U7594a. Work Issue: #7594. Journey stage: Understand (`.agents/data/journey.md`). Source: the user's report #7594: the fold arrow on a Mode row (Delivery, Planner) does nothing, while the same arrow folds a Workstream. Amends U4707's fold clauses and U4547a's remembered collapse only by naming the Mode as foldable. Webview only: no RPC method, App command, contract, code term or Token. Terms: Rail, Mode, Workstream (`GLOSSARY.md`).

**U7594a a Mode's fold arrow folds its children.** Given a Rail with a Mode that has child rows (`apps/desktop/src/rail/layout.ts`, `isMode`), then:
- **Fold.** Pressing its fold arrow, or Left on the focused Mode row, hides every row beneath it; the Mode row stays, shows the same collapsed summary as a folded Workstream (U5940a) and exposes `aria-expanded="false"`. Pressing the arrow again, or Right, shows the rows again and exposes `aria-expanded="true"`. Selection, Agent state and RPC calls do not change. Asserted in `u7594a_a_mode_arrow_folds_and_reopens_its_children` (Vitest against the fake App: a Mode with two child rows loses them on the press and regains them on the second press).
- **Remembered.** The fold is saved as a Workstream's is and survives remount. Asserted in `u7594a_a_folded_mode_stays_folded_after_remount` (the same lane, using the persistence seam of U4547a).
- **One rule.** An arrow shown on a row always folds that row: no row kind shows the arrow while its press changes nothing. Asserted by the first test, which presses the arrow of a Workstream and of a Mode through the same helper.

Policy (design critic): the Delivery row, folded and open, in dark. Run `just capture U7594a`; leave images under `artifacts/ux/U7594a/` (`.agents/data/harness.md`, Captures). Moves: D2.
