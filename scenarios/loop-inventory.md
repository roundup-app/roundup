# Loop stock tools

**L117 measured inventory and removal plan.** Specification acceptance for #1602. This adds documents only; it does not implement a replacement or retire any existing scenario.

- Given the pinned main commit in `docs/loop-inventory.md`, then exactly one inventory row exists for each `loop/*.py`, `loop/*.sh` and `.github/workflows/*.yml`, including tests; each states physical lines, scenario served, stock candidate and keep/replace/delete decision. Observer: the inventory validation command in that document (policy/document observation).
- Then the document reports both inventoried and all-tracked totals for `loop/` and `.github/workflows/`, states counting rules and pins the measured commit. Observer: the same command (policy/document observation).
- Then merge queue, stock Claude review/mention modes, Issue forms, actionlint, required reviews/auto-merge and deletion of loop-only observers each have a sourced capability/limitation decision. Observer: independent review verifies the source links and row boundaries (policy).
- Then each replace/delete row names its own validated Work Issue, natively blocked by #1602 and every open overlapping owner identified at filing; any unavoidable shared implementation files are serialized, not silently expanded. Observer: independent review reads native dependencies and the filing table (policy).
- Then exactly one labelled `flag:needs-user` settings Issue asks about merge-queue eligibility and the ruleset, with a recommendation and the consequence of keeping personal ownership. It does not hold this inventory PR. Observer: independent review reads that Issue (policy).
- Then the plan preserves the four exact-head, independent, main-owned gates in `.agents/data/gates.md:7`–`11`. Generic stock approval never clears the critic; an author cannot supply their own gate. Observer: independent review of the written plan (policy).

Checks moved: none; no product UI or runtime changes. Implementation Issues first specify their own superseding acceptance before removing active observer policies. L117 observes delivery of the plan, never delivery of those implementations.
