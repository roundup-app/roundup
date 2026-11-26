# UI: the user saves a read readback and its diagram as a Pad in the Agent's Workstream (U7702a–U7702g)

Module: `apps/desktop/src/changes/` (the save action, its states, the Pad's text), the fake App and its fixtures. Ids: U7702a, U7702b, U7702c, U7702d, U7702e, U7702f, U7702g. Work order: [#7702](https://github.com/roundup-app/roundup/issues/7702), blocked by #7688 (merged). Owner, 2026-11-18, from the Plannotator audit: "Save readback as a Pad"; a read Overview can be saved as a Pad, the readback with its diagram, that stays with the Workstream (P6, P12). Owner, 2026-11-26: "use proper icons I don't like textual actions", so the save action is an icon button with no visible text, a tooltip and an accessible name from `copy`; the status lines stay words.

**Precedence.** A design check (the critic, a D-check) that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

No new Daemon method, Message or contract change: the App calls `pad.create`, then `pad.move` (`CreateParams` has no home, P12). The settled rule of #7687 and #7688 holds: the readback's own text is never sent to the Agent; the user may save its words as a Pad, an ordinary Pad made by the user's click, with no Pad rule of its own. A readback is a personal aid, never a gate.

**Fixture.** U7688's: the fake App's `agent.readback` answers a read result (an overview, a diagram `Before` `run -> load` `After` `run -> cache -> load`, one module account, one flow with two steps, one gap) for Agent `a`, which sits under Workstream `w1`; each test's handlers answer `pad.create` and `pad.move`.

**U7702a the save action shows with a read or stale readback, and nothing saves unasked.** Given the fixture on the Tree target, then:
- **Shown.** An icon button, with no visible text, named "Save as Pad" (accessible name and tooltip from `copy`) shows in the Overview's readback block while the state is `read` or `stale`, and not while it is not read, reading or failed.
- **Unasked.** Opening the view, a turn that wrote, a Fetch and a second of waiting call `pad.create` and `pad.move` zero times. Asserted in `u7702a_the_save_action_shows_with_a_read_or_stale_result_and_nothing_saves_unasked`.

**U7702b one click saves a copy as a Pad in the Workstream.** Given a read result, then a click calls `pad.create` once and then `pad.move` once, and calls no other method that sends or saves:
- **Text.** The Pad is a copy made at that moment. My reading, kept: its markdown opens with the name (the Agent and the date) and the date, From and To the readback read (remote main to Tree or Branch), then holds the overview, the diagram (U7702e), each module's account, each flow with its steps' notes in call order, and each gap as "<Agent> said: … The diff: …" with its file and line; a part with nothing to show is left out, never an empty heading.
- **Home.** `pad.move` names the Agent's nearest Workstream (`resolvedWorkstream`, `apps/desktop/src/state/railTopology.ts`); an Agent under no Workstream saves at the Project root and calls no `pad.move`. A status line says "Saved as <name>" and the click does nothing more while it saves.
- **Drawer.** My reading, narrowed: the Drawer does not open on the new Pad. The user is reading a diff in the centre (P16); the status line names the Pad, and the Pads tab lists it under the Workstream. Policy.
- Asserted in `u7702b_one_click_creates_the_pad_then_moves_it_to_the_workstream` and `u7702b_an_agent_under_no_workstream_saves_at_the_project_root`.

**U7702c a failure says why in words.** Given a read result, then:
- **Move failed.** My reading, kept: when `pad.move` fails, the Pad stays at the Project root and the status line says "Saved <name>, but it stays at the Project root" with the cause.
- **Create failed.** When `pad.create` fails, nothing is saved, the status line says "Couldn't save the readback" with the cause, and no `pad.move` is called.
- **No answer.** A `pad.create` or `pad.move` with no answer is unconfirmed, never a failure (U5172a): the status line says so (`unknownOutcomeLine`) and no call repeats.
- Neither retries by itself; a second click starts a new save. Asserted in `u7702c_a_failed_move_leaves_the_pad_at_the_root_and_says_so`, `u7702c_a_failed_create_saves_nothing_and_says_so` and `u7702c_a_create_with_no_answer_says_so_and_repeats_nothing`.

**U7702d each save makes a Pad, named readably.** Given a read or stale result, then:
- **Name.** My reading, kept: the name is "Readback: <Agent> <date>" (the date as `YYYY-MM-DD`, the Agent's name without `/`, `\` or `..`, which Pad names refuse, P8). The user renames it as any Pad.
- **Taken.** A name the Daemon refuses as taken (`CONFLICT`, P1) gets " 2", then " 3" and so on, at most twenty tries; saving twice makes two Pads and never overwrites one.
- **Stale.** A stale readback saves its old text, dated, with the line "Changed since readback" above the overview.
- Asserted in `u7702d_saving_twice_makes_two_pads_and_a_stale_readback_saves_its_old_text` and `u7702d_a_taken_name_gets_a_suffix`.

**U7702e the diagram saves as Mermaid.** Pads render a `mermaid` fence (P2544e). Given a diagram text, then `readbackText` (`apps/desktop/src/changes/readbackPad.ts`) reads it with `parseDiagram` (`diagram.ts`; no second parser) and writes one `flowchart` fence for each panel that holds a call, under its "Before" or "After" word, with each part a generated node id and a quoted, escaped label; the lines of a panel that are not a call stay as text, and a diagram with no call writes its words alone. Asserted in `u7702e_the_diagram_becomes_one_mermaid_block_for_each_panel_and_words_stay_text`, which includes a part named `say "hi" now`.

**U7702f the readback stays a personal aid.** Amends U7688f: the view sends no Message and saves nothing from a readback unless the user clicks the save action (U7702b); it edits none of its text and gates no Landing or Viewed mark on it. Policy: no automatic save, no Pad for each module, no outline for a long Pad.

**U7702g the rendered save at 1512 by 950.** Given the U26 harness, dark App, on the Overview of the 14-module fixture, then the readback with its save action, the saved state and a failed move are captured, each in its own browser session (#7924). D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U7702g`; evidence under `artifacts/ux/U7702g/`, uncommitted. Policy; the design critic judges layout and looks, never a Vitest test (rule 10).

**Amended.** U7688f ("saves no note or Pad from a readback", now "unless the user clicks Save as Pad", U7702f). Kept: the readback's states, gaps and diagram as built.

Not wanted: an automatic save; a Pad for each module; a new Daemon method; an outline for a long Pad (owner, 2026-11-18); Plannotator (plannotator.ai) as the review surface (owner, 2026-11-18). No test of layout or looks.

Checks on main (numbered references, not claims that this specification implements them):

1. `apps/desktop/src/changes/diagram.ts`: `parseDiagram`.
2. `apps/desktop/src/state/railTopology.ts`: `resolvedWorkstream`.
3. `scenarios/pads.md`: P1 (a taken name is `CONFLICT`), P12 (`pad.move`), P2544e (the Mermaid fence).
4. `apps/desktop/src/changes/ReadbackBlock.tsx`: `ReadbackAction`.
5. `scenarios/ui-changes-readback.md`: U7688f.
6. `scenarios/ui-changes-icon-actions.md`: U7933a (icon-only actions).
