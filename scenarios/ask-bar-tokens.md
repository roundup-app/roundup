# The Ask bar reads `#Project` and `@Workstream` anywhere in its text (U8045a–U8045e)

Module: `apps/desktop/src/ask/` (`AskBar.tsx`, `projectPick.ts`, `copy.ts`), `apps/desktop/src/ui/Mentions.tsx`, the Daemon's ask module (`crates/agents`), `crates/contracts`, `contracts/generated/`. Ids: U8045a, U8045b, U8045c, U8045d, U8045e. Work order: [#8045](https://github.com/roundup-app/roundup/issues/8045). Owner, 2026-11-27, on the Ask bar: "this view needs proper redesigning spacing alignment and iteractions and visbility and behaviour"; on the Project picker: "I think should be @ project name too or # like slack not a select list"; on the drafts: "Yes I love that desing and you should file the issues and screen to match this promised draft details". The owner picked frames 3, 4 and 5 of the draft:

```
│ fix the login bug in #ed█                  │
│                     ┌ Education ────────┐  │
│                     │ meta-harness      │  │
│ fix the login bug in [#Education] and tell [@Loop control] │
```

Contract change (rule 4, the Contract recipe of `.agents/builder.md`): `ask.send` reads `#Project` and a mid-text `@Workstream`; every caller changes in the same PR and `contracts/generated/` is regenerated from `crates/contracts`. Reuse `Mentions` (`@ui-sdk/solid/command`). No new RPC method.

**Precedence.** A design check that reads a decision here as a defect changes how it is drawn, never the decision. When both cannot hold, `ask` (`flag:needs-user`).

**Words.** A *token* is `#` or `@` plus the non-space characters after it, where the `#` or `@` starts the text or follows a space. `<Project>` is an open Project's name, `<name>` a Workstream's name, both matched ignoring case. Every word the bar shows is read from `copy.ts`.

**U8045a a typed `#` or `@` opens its list anywhere in the text.** Given the Ask bar with two or more open Projects and at least one Workstream, then:
- **Opens.** A token being typed, at the start or after a space and anywhere in the text, opens a list: `#` lists the open Projects, `@` lists the Workstreams of every open Project. Today `@` lists only while the whole text is `@word` (`mentionOf` in `AskBar.tsx`); that limit goes. Asserted in `u8045a_hash_after_a_space_mid_text_opens_the_project_list` and `u8045a_at_mid_text_opens_the_workstream_list`.
- **Open Projects only.** The `#` list holds the open Projects and no other; typed letters narrow it. A `#` with no space before it (`a#b`) opens nothing. Asserted in `u8045a_the_hash_list_holds_only_open_projects` and `u8045a_a_hash_inside_a_word_opens_nothing`.
- **Pick.** Enter or Tab picks the highlighted row and writes `#<Project> ` (or `@<name> `) in place of the token being typed, leaving the text around it. Asserted in `u8045a_picking_a_project_writes_the_token_and_a_space`.
- **Esc.** The first Esc closes the list and keeps the bar and the draft; the second closes the bar (U6175c). Asserted by `u504_escape_closes_mentions_and_keeps_the_draft_in_%s`, edited to open a `#` list, and `u8045a_escape_closes_only_the_hash_list`.
- **No call per keystroke.** Typing a token makes no Placement call; U6271b's one call per pause stands. Asserted by `u6271b_typing_pausing_then_sending_unchanged_text_makes_one_call`, unchanged.

**U8045b a set token shows tinted in the text.** Given text holding a token that names an open Project or a Workstream exactly, then the token shows tinted in the text (frame 5), and a token naming neither stays plain text. The tint is a Token of the design system (rule 8) and the text stays one editable field, so the caret, selection and IME act on the text as typed. Asserted in `u8045b_a_set_token_is_marked_and_an_unknown_one_is_not` (the marker's role and name, never its colour); the look is policy for the critic (U8045e).

**U8045c `#Project` fixes the Project of the Ask.** Contract change (above). `ask.send {text}` finds the `#<Project>` tokens in the text, and a token naming no open Project is plain text. Given the text, then:
- **One token.** Exactly one distinct Project named: it is the fixed Project of every part, so the Placement request offers only that Project's Workstreams and asks for no Project choice, as U6271a's Fixed Project clause. Test: `u8045c_one_hash_project_fixes_every_part`.
- **Two tokens.** Different Projects named: each part takes the Project named inside its own text, and a part naming none takes the first token's. Test: `u8045c_two_hash_projects_each_part_takes_its_own`.
- **Byte for byte.** The text reaches the Door with its tokens, byte for byte (A41), except that a leading `@<name> ` is still cut as A40 does. Test: `u8045c_the_door_gets_the_hash_token_in_the_text`.
- **Chip gone.** The bar shows no Project chip and no select list; the token is the pick (amends U6271b: its chip clauses read the token, and "The owner's pick" is the `#` list of U8045a). A part's Project the owner did not name is still roundup's pick, shown in the sent row (U6271c). Test: `u8045c_the_bar_has_no_project_chip`.

**U8045d `@Workstream` anywhere routes the Ask.** Contract change (above). Given `ask.send {text}`, then:
- **Mid-text.** Exactly one distinct `@<name>` token in the text, matching exactly one Workstream's name, gives one `routed` part and no Placement call, as a leading `@` does (A40); the part holds the text byte for byte, a leading `@<name> ` cut and a mid-text token kept. Test: `u8045d_a_mid_text_at_name_makes_no_call`, with aimock's request log empty.
- **No match or many.** A token naming no Workstream, or more than one, is `unclear` with A40's questions and no call; a token naming a Workstream in a Project the Ask fixed with `#` is read inside that Project only. Test: `u8045d_an_unknown_mid_text_at_name_asks_back`.
- **Two Workstreams.** Two different `@` Workstreams run Placement, and its request offers only the named Workstreams. Test: `u8045d_two_at_workstreams_offer_only_those_to_placement`.
- **Both tokens.** `#Education` with `@<name>` in one text fixes the Project and routes to the Workstream with no call. Test: `u8045d_hash_and_at_together_route_with_no_call`.
- **Usage only when asked (P9).** Unchanged: a Placement call runs only for an `ask.send` that names no Workstream.

**U8045e the rendered bar for the critic.** Given the U26 harness with two open Projects, then at 1512 by 950 and at 388 px, dark and light: the `#` list, the `@` list and the tinted tokens match frames 3 to 5, with the spacing, alignment, visibility and focus the owner asked for, no sideways scroll, and D2, D5, D6 and every Check passing on `main` still pass. Run `just capture U8045e`; evidence under `artifacts/ux/U8045e/`, uncommitted. Policy; the critic judges layout and looks against the draft frames, never a Vitest test (rule 10).

**Amended.** A40 ("Naming a Workstream skips the call": `@<name>` anywhere, not only leading; the part holds the text with a leading `@<name> ` cut as today), U504 ("leading `@` Workstream selection": `#` and `@` lists open at a token anywhere; test `u504_at_lists_workstreams_and_writes_the_name` also covers a mid-text token), U6175c (Esc closes the `#` list first as the `@` list), U6271b ("One chip per part" and "The owner's pick": the `#` token replaces the chip). Kept: U6271a's request and delivery clauses, U6271b's one call per pause, U6271c, A41.

Not wanted: a Project select list or chip control, a Placement call per keystroke, a Vitest test of looks (rule 10).

Checks on main (numbered references, not claims that this specification implements them):

1. `crates/agents/tests/asks/placement.rs`, `a40_naming_a_workstream_makes_no_call`: the call-free route.
2. `crates/agents/tests/placement.rs`, `u6271a_a_fixed_project_narrows_the_request`: the fixed Project.
3. `apps/desktop/src/ask/u504_ask_bar.test.tsx`, `u504_at_lists_workstreams_and_writes_the_name` and `u504_escape_closes_mentions_and_keeps_the_draft_in_%s`: the list and Esc.
4. `apps/desktop/src/ask/u6271b_project_chip.test.tsx`, `u6271b_typing_pausing_then_sending_unchanged_text_makes_one_call`: one call per pause.
5. `crates/agents/tests/asks.rs`, `a41_the_door_gets_the_users_words_byte_for_byte`: exact bytes.
6. `scenarios/ui-shortcuts.md`, U6175c; `scenarios/ask-bar.md`, A40, U504, U6271a, U6271b, U6271c.

No implementation is delivered by this specification.
