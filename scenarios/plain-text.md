# Plain text

Module: `crates/agents` (the pinned style inside the Brief, under `claude_code/`, P4), `apps/desktop` (Drawer and Rail text). Terms: Brief, Work order, Digest, Decision, Message, Pad (`GLOSSARY.md`); `hold:Plain` is the output style `hold/output-styles/plain.md` of `saadshahd/moo.md`. Principles served: P3, P6. No contract change: a Work order holds only `ask` and `limits`; the Steer of O2 and the Drawer change. Reported in #676. Ids: Q1–Q5.

**Q1 every Agent writes in hold:Plain.** Given any Agent roundup starts (`agent.spawn` (A4), `rail.startDoor` (A7)), then its E1 Brief carries the whole body of `hold/output-styles/plain.md` from `saadshahd/moo.md` commit `595eda0e3b477d1af1daad82f395073d4f912c8d` (plugin `hold` 0.0.9, file sha256 `0f2c26f0cea8ba39af771d2fdb09db6ae4a7a90c64c272a0a0e967f420e9af1e`), vendored byte for byte at `crates/agents/assets/hold-plain.md`, and tells the Agent to write every Work order, Message to `you`, `ask_user` question, Digest and Pad reply in it. Delivery is the Brief's `--append-system-prompt-file` (E1) because it needs no install, works in any Project and leaves `CLAUDE.md`, `.claude/` and the user's settings with their bytes. A settings file with `outputStyle` is rejected: it names a style file that must sit in the user's `.claude/output-styles`, which E1 forbids writing. The plugin is rejected: the user would have to install it. The pin moves only in a PR that changes the vendored file, its sha256 above and this clause together. Tests: `q1_pin` hashes the vendored file against the sha256 above (policy for the commit); `q1_brief` reads the argv's Brief of a fake `claude` for an ordinary Agent and a Door and finds the vendored body in both. The real-Daemon harness (the observer of B24) asserts the same on a started Agent's Brief.

**Q2 the generated text the App shows.** Given the text roundup's Agents generate, then each surface below renders it as Q3 lays it out and has its own layout test:

| Surface | Text | Test |
|---|---|---|
| Drawer: Work order (`OrderDrawer`) | ask, limits | `q2_order_drawer` |
| Rail and Workstream order line (`OrderLine`) | the one-line order | `q2_order_line` |
| Thread: a Message to or from `you` | body | `q2_thread_message` |
| Decision Card (U113) | `ask_user` question and its answers | `q2_decision_card` |
| Digest Card (B22) | the Digest | `q2_digest`, written with the surface: no Digest Card component exists yet |
| Pad Drawer: Pad reply (#675) | the reply | `q2_pad_reply`, written with the Pad Drawer's reply (#675, U190): no `pad.ask` caller exists yet |

A Message between Agents stays one line (U106). A Terminal keeps mono (design-system: mono is for the Terminal, paths, ids and code). Text a user typed is not generated text and keeps its layout.

**Q3 hold:Plain's layout.** Given any text of Q2, then the rendered element has `text-align: left` (not `center`) and the computed `font-family` is `--font-ui` (`apps/desktop/src/tokens.css:24`), not `--font-mono` (the `:root` font through `--mono` at `apps/desktop/src/styles.css:3`). A status reply of rows renders as an HTML table, never as preformatted text; a code fence and inline code stay `--font-mono`. A part with a label (Q4) is a heading over its content. Lines wrap at the Drawer's width with no horizontal scroll at 700×800 and 1280×800 (D10). Text meets D2 and D5. Test: `q3_` renders each surface of Q2 in Vitest and reads computed style and DOM, with a seed holding a 3-row table and a limit of 300 characters.

**Q4 a Work order has visible parts.** Given a Work order `{ask, limits}` (O1), then the Drawer shows, top to bottom: the ask; if `limits` is not empty, a heading `limits` over a list of each limit as the Agent wrote it. No item has a prefix, and no label negates or inverts a limit: limits are stated as rules that read on their own ("Change no file in the repo"). Where an order has no limits, that part and its label are absent. The O2 Steer lists the same parts with `Limits:` in place of `Must not:`; the Door's B24 policy tells it to write each limit as a positive rule. Test: `q4_` renders an order whose limits are positive sentences and asserts that no `must not:` precedes any of them, that the only label is `limits`, after the ask, and that the text is left-aligned in `--font-ui`; a second case omits limits and finds no label.

**Q5 the Rail's one-line order says it in words.** Given a Work order, then `orderLine` (O6) is the ask, then the limits count in words (`no limits`, `1 limit`, `3 limits`), for example `Give a short tour · 3 limits`; it never contains `must not`. A Clarification order stays `clarifying: <question>`. The line is cut to one line as O6 says. Test: `q5_` over the four forms.
