# Readback with a Skill: the user may pick one of their own Skills as the readback's brief (RS1–RS6)

Module: `crates/agents` (the Adapter and the call), `crates/contracts`, `crates/rupd`, `apps/desktop/src/changes/` (the picker), the fake App. Ids: RS1, RS2, RS3, RS4, RS5, RS6. Work order: [#7701](https://github.com/roundup-app/roundup/issues/7701), blocked by #7688 (merged, `scenarios/ui-changes-readback.md`). Owner, 2026-11-18, picked "Your Skill as its brief": the user may want the readback to review as one of the Skills they already keep, such as a security review; only the user starts the readback. Precedence: when a design check reads one of these as a defect, the drawing changes, never the decision; when both cannot hold, `ask` (`flag:needs-user`).

Contract change (rule 4): `agent.readbackStart`'s params gain an optional `skill` (a Skill name); `agent.readback` and every result stay as RB3 says. Every caller changes in the implementing PR: `contracts/generated/` (regenerated, never hand-edited), `crates/rupd/src/route/policy.rs` where it lists the params, `scenarios/rpc.md`, the fake App (`apps/desktop/src/testing/fakeApp.ts`, `apps/desktop/src/state/connectedProject.ts`). `GLOSSARY.md`'s **Readback** gains "may be briefed by one Skill". Gates read: P4 (RS2), P8 (the Model stays the `readback` Role's, A7686), P9 (RS1, RS4), P11 (RS5), P14 (no figure). Laws M1 to M10 are not touched. Reuse (rule 9): the Ark UI select (`@ark-ui/solid`, installed, behind the `apps/desktop/src/ui/` select primitive) and `agent.skills` (A31); no library is added, and the PR says so. A readback is a personal aid, never a gate, and its text is never sent to the Agent.

Amends by name: RB2's `agent.readbackStart {id, to}` (an optional `skill`) and U7688a's not-read state (the picker beside the button).

Decisions this specification takes:
- **The seam cannot carry a Skill by name.** A7686's `ReadbackCall::read(system, input)` takes only text. So the Adapter reads the Skill's body inside `crates/agents/src/claude_code/` (A31's folders), and the call gains an optional `lens`, which the Adapter adds to the system prompt. No other module reads a Skill's body or a vendor path (P4).
- **A lens, not an override.** The fixed prompt stays whole, the Skill's body follows it under "Review lens", and the result shape (RB3) and every check on it (RB3, RB4) stay as they were: a Skill never changes the shape.
- **Remembered:** the choice is not remembered. A new Overview opens with none picked (P11: a lens is a deliberate act, and a stale pick is a surprise cost to the user's usage).
- **Names:** the picker's names are exactly those `agent.skills` returns for the Agent, including `<plugin>:<name>`.

**RS1 a start with a Skill name passes it once; a start without one passes none.** Given a fake `claude` and an Agent with a Worktree, then `agent.readbackStart {id, to, skill: "security-review"}` passes the Adapter one lens, the body of that Skill, and step one's system text holds the fixed prompt and then that body; step two's system text holds none. A start with no `skill` passes no lens and its system text is the fixed prompt only. A second start that joins a run in flight (RB2) passes nothing more. Asserted in `rs1_a_start_with_a_skill_passes_its_body_once_and_without_one_passes_none` (Rust, fake `claude` that records its system text).

**RS2 only the Adapter reads the Skill's body.** Given a Skill the user keeps in `<home>/.claude/skills/<dir>/SKILL.md`, then the Daemon names it and the Adapter reads the body from the folders A31 lists; no non-test source outside `crates/agents/src/claude_code/` names `SKILL.md`. Asserted in `rs2_the_skill_body_is_read_inside_the_adapter` and the existing A31 vendor-path test.

**RS3 an unknown Skill fails with its cause and starts no run.** Given a `skill` that `agent.skills` for the Agent does not list, then `agent.readbackStart` answers `{state: "failed", cause}` in words, naming the Skill, and the fake `claude` is launched zero times; the state a kept result held is not replaced. Asserted in `rs3_an_unknown_skill_fails_naming_it_and_launches_nothing`.

**RS4 a Skill never changes the shape or the start's rule.** Given a Skill whose body says to answer in another shape, then the result is checked as RB3 says (a malformed answer fails `badAnswer`), the readback's own text is sent to no Agent, and nothing but the user's call starts one (RB2). Asserted in `rs4_a_skill_does_not_change_the_checked_shape`.

**RS5 the picker lists the Agent's Skills and a start carries the choice.** Given the fixture of U7688 on the Tree target and a fake `agent.skills` answering `security-review` and `plugin:lint`, then in the not-read state:
- the picker beside the button lists those names and no more, and offers "No Skill" first, picked; an Agent whose `agent.skills` is empty shows no picker;
- choosing one and pressing R (or the button) calls `agent.readbackStart` once with that `skill`; with no choice the call holds no `skill`;
- opening the view calls `agent.readbackStart` zero times, and `agent.skills` once at most;
- after a run starts, a new Overview shows "No Skill" again (not remembered).
Asserted in `rs5_the_picker_lists_the_agents_skills_and_a_start_carries_the_choice` and `rs5_opening_the_view_starts_nothing` (Vitest, fake App).

**RS6 the rendered picker at 1512 by 950.** Given the U26 harness, dark App, then the not-read state with the picker is captured; D2, D5, D6 and every Check passing on `main` still pass. No test of layout or looks (rule 10): the design critic judges it. Observed by `just capture U7688a`.
