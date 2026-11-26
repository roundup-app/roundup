# Readback: step through the diagram one stop at a time (RB21, U7703a–U7703g)

Module: `crates/agents` (the result), `crates/contracts`, `contracts/generated/`, `apps/desktop/src/changes/` (the stepper, the lit part), the fake App and its fixtures. Ids: RB21, U7703a, U7703b, U7703c, U7703d, U7703e, U7703f, U7703g. Work order: [#7703](https://github.com/roundup-app/roundup/issues/7703), blocked by #7688 (merged, `scenarios/readback.md`, `scenarios/ui-changes-readback.md`). Owner, 2026-11-18, from the Plannotator audit: "Step through the diagram": walk the diagram one stop at a time, lighting the part each stop is about. Owner, 2026-11-26: "use proper icons I don't like textual actions", so Previous and Next are icon buttons with no visible text, a tooltip and an accessible name from `copy`; each stop's sentence and the stop count stay words.

**Precedence.** A design check (the critic, a D-check) that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

Contract change (rule 4): `Account` (RB3) gains `stops`, so `agent.readbackStart` and `agent.readback` answer a new shape. Every caller changes in this PR: `contracts/generated/` (regenerated, never hand-edited), the fake App's fixtures and the `Account` literals of the Changes tests, `docs/worktrees.md` (the `agent.readback` row), `scenarios/readback.md` (RB3 names the new field) and `GLOSSARY.md` (add **Diagram stop**). No new Daemon method, App seam command or Message. The Pad U7702 saves is unchanged: it holds the account's words, not its stops. Laws M1 to M10 are not touched. Gates read: P9 (the run is the user's and a step makes no call); P8 (the `readback` Role's Model and Effort, #7686, unchanged); P14 (no token, price or usage figure); P11 (a stale result says so). Reuse (rule 9): U7703g. A readback is a personal aid, never a gate, and its text is never sent to the Agent.

Decisions this specification takes (the Issue's "My reading" points, each kept and tested unless it says narrowed or policy):
- **Stops come with the run.** Step one of #7687's run also writes the stops, so a step makes no model call (P9). A stop is `{part, text}`: `part` the name of a part of the diagram, `text` one sentence about it, in the order to walk them. The Daemon keeps them as given, trimmed, drops one with no part or no text and keeps the first twelve; a missing `stops` key is none. It never fails a paid run on them, as RB16 never does.
- **Narrowed: no example case.** The Issue's optional named example case to follow is dropped: no clause of its Bar names it and a stop's sentence can carry an example. Nothing in the result holds it.
- **The App names the nodes.** The diagram's text is the format `parseDiagram` reads (RB3's policy), so only the App knows which parts it draws. A stop names a node by the name `parseDiagram` gives it (`bare`: the part with its bullet, bracket or backtick wrapping removed); the App keeps the stops that name a drawn part, in order, and drops the rest. No second parser exists, and the Daemon never reads the diagram's text.
- **A part lights wherever it is drawn.** A name in both the Before and the After panel lights in both; the figure's box and the rows of the words that name it (a call from or to the part) are the lit state. Below 480 px (U7688c) the figure gives way to its words, so the rows carry it and the stepper stays.
- **Ends.** The stepper opens on the first stop. Previous does nothing at the first, Next at the last (`aria-disabled` on the icon button); there is no wrap and no autoplay. A new run starts again at the first stop; a result that replaces the old one while it reads keeps the position, clamped to the new count.
- **Above the diagram, in words.** The stop count ("2 of 5") and the stop's sentence show in a status region above the figure, the text first and the two icons at the trailing edge; they are #7688 decision 5's text equivalent of the lit part.
- **Keys.** Left and Right step the stops while the diagram has focus (the figure takes Tab focus only when it has a stepper), and no field, editor, diff or list row holds the key. The ? list names them (U7679e).
- **Not drawn for an explanation.** An explanation's diagram (U7698b) has no stops and draws as before.
- **One stepper, not two.** #7546's chart viewer is not reused and no statechart or XState is built here (policy: U7703g). The stop is a position in a list: a union and step functions in the App's own code.

**RB21 the result carries the stops the run wrote.** Given a fake `claude` whose step-one answer holds `stops` for the diagram, then `agent.readback` answers `stops` as `[{part, text}]` in the order given, trimmed; an answer with no `stops` key reads with none. Asserted in `rb21_a_read_run_carries_its_stops_in_order_and_an_answer_without_them_has_none` (Rust, fake `claude`).
- **Dropped and capped.** An entry with an empty part or an empty text is dropped and the run stays read; of fifteen valid entries the first twelve are kept. Asserted in `rb21_a_stop_without_a_part_or_text_is_dropped_and_twelve_are_kept`.
- **The result's other rules hold.** RB7 (a write that changes the diff makes it `stale` with the stops kept), RB2 (reading launches nothing) and RB12 (a restart drops them) apply to stops as to every field, through the one `Account`; `rb17_explanations_stay_with_a_stale_result_and_start_no_call` stands for all and no second test repeats it. The prompt asks for the stops and for parts the diagram names; the Daemon never fails a run on either (policy, as RB3).

**U7703a a result with stops draws the stepper, and the view asks for none.** Given the Changes view on the Tree target with the fake App, then:
- **Drawn.** An `agent.readback` answering `read` whose diagram is `Before\nrun -> load\nAfter\nrun -> cache -> load` and whose three stops name `run`, `cache` and `load` shows the Overview's readback with a stepper: a group named "Step through diagram", the stop count "1 of 3" and the first stop's sentence.
- **Not drawn.** A result with no stops, and one whose stops all name a part the diagram does not draw, shows no stepper; a stop that names an undrawn part among drawn ones is dropped and the count says so ("1 of 2"). A diagram with no `A -> B` line has no drawn part and so no stepper.
- **Asks nothing.** Opening the view and drawing the stepper call `agent.readbackStart` and `agent.explain` zero times. Asserted in `u7703a_a_result_with_stops_draws_the_stepper_and_one_without_draws_none`.

**U7703b Next and Previous move the lit part and the sentence, and call nothing.** Given the fixture of U7703a, then:
- **Icons.** Previous and Next are icon buttons with no visible text; their accessible names and tooltips are "Previous stop" and "Next stop" (`copy`), drawn with the left and right glyphs of `ink/Icon.tsx`.
- **Step.** Next shows "2 of 3" and the second stop's sentence and marks the rows of the words that name `cache` (`aria-current`), and no others; `load`, named in both panels, marks its rows in both. Previous goes back.
- **Ends.** Previous at "1 of 3" and Next at "3 of 3" are `aria-disabled` and leave the stop where it is.
- **No call.** Every step, key included, calls zero Daemon methods (P9). Asserted in `u7703b_next_and_previous_move_the_lit_part_and_the_sentence_and_call_nothing`.

**U7703c Left and Right step a focused diagram, and only then.** Given the fixture, then with focus on the diagram Right and Left do what Next and Previous do; with focus on a list row, the diff or the Overview's other text they step nothing, and a row's own Left and Right fold or unfold as before (U7679e). Opening the ? list shows the line that names the two keys. Asserted in `u7703c_the_arrow_keys_step_a_focused_diagram_only`.

**U7703d a stale result dims the stepper, and a new run starts again.** Given a `stale` answer, then the stepper stays inside the account that is dimmed (`data-stale`) with "Changed since readback" and still steps; starting the readback again (R) and a new `read` answer opens on the first stop. Asserted in `u7703d_a_stale_result_dims_its_stepper_and_a_new_run_starts_at_the_first_stop`.

**U7703e the lit part is drawn without motion, and by Tokens.** The lit box and rows change by an attribute, with no transition or animation on a key action (#7675), in the App's Tokens (rule 8); the stepper's buttons carry no visible text. Policy: the design critic judges it, never a Vitest test (rule 10).

**U7703f the rendered stepper at 1512 by 950 and at 388 px.** Given the U26 harness, dark App, on the 14-module fixture with the fake `agent.readback`, then the first stop, a middle stop and the last stop are captured at 1512 by 950 and at 388 wide, each in its own browser session (#7924); D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U7703f`; evidence under `artifacts/ux/U7703f/`, uncommitted. Asserted in `u7703f_the_stepper_is_captured_for_the_critic`.

**U7703g reuse.** The stepping is built, and the PR's `Reuse:` section names why each candidate fails: #7546's chart viewer (it draws its own chart from a block of states and moves, has no authored order or single Next and shows no sentence per stop beside a diagram that is the text equivalent); `driver.js` 1.14.0 and its `headless` entry (a tour over DOM elements: the figure is an `aria-hidden` SVG that is absent below 480 px, its overlay and popover sit on `document.body` with a window key listener for the arrows and Escape, which the view's own keys and close use, and it would add a step index the App's one function already is); `shepherd.js` 16.0.0 (AGPL-3.0, so it fails on licence). `xstate` is no candidate (#7546 decision 6). `@lucide/solid` through `ink/Icon.tsx` gives the glyphs. Policy.

**Amended.** RB3 (`scenarios/readback.md`): the result also holds `stops` (RB21). U7688c (`scenarios/ui-changes-readback.md`): the diagram's nodes are named by `parseDiagram` and the Overview's diagram carries the stepper (U7703). U7679e: the ? list gains Left and Right for a focused diagram. U7933a's icon rule and #7860's icon actions are followed, not changed. Kept: the diagram, its text equivalent and its narrow-width rule; the readback's rules (the user starts it, on the Model the user set for its Role, never a gate).

Line budget: about 800 changed lines (result and Contract 60, stepper 150, tests 300, fixtures and copy 60, scenarios 80), inside work.md's 1,000 for an API change with all its callers.

Not wanted: autoplay; any animation or transition; a model call per step; a token, price or usage figure (P14); a statechart or XState here (#7546, #7548); an example-case field; Plannotator (plannotator.ai) as the review surface, rejected by the owner, 2026-11-18; a visible-text action button. No test of layout or looks (rule 10).

Checks on main (numbered references, not claims that this specification implements them):

1. `scenarios/readback.md`, RB3: the result's shape this extends.
2. `scenarios/ui-changes-readback.md`, U7688c: the diagram and its words, below 480 px the words alone.
3. `apps/desktop/src/changes/diagram.ts`, `parseDiagram`: the one parse a stop's part is named from.
4. `apps/desktop/src/changes/ReadbackBlock.tsx`, `ReadbackAction`: the icon button the stepper reuses.
5. `apps/desktop/src/changes/ChangesView.tsx`, `registerChangesKeys`: where the keys register.
6. `scenarios/ui-changes-icon-actions.md`, U7933a: the icon rule the buttons follow.
