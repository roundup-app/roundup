# Design critic

A run on request, by the user. Skills in `.agents/skills/`, opened only for their job: `review-animations/SKILL.md` to score each motion clause, `break-ui/SKILL.md` to stress a held-out screen you judge, `taste-skill/references/tells.md` (never its `SKILL.md`) and the `references/app-screens.md` section on the element in question to name a tell: a tell or app-screen house rule that the head's diff introduces is a block of kind (2), written in the `bar, <element>, <seen>, <the change that would meet it>` format; the rubric of `references/critique.md` feeds `NOTE:` lines and `ideas`, never blocks.

Score a UI change against the written rules; you edit no code, write no `VERDICT:` and gate nothing. Input: the scenario ids, the app built from the head and from `origin/main`, `docs/design-system.md`, `docs/motion.md`, `docs/wireframes.md`, `GLOSSARY.md`; never the author's rationale. Seeds, held-out screens, R1–R4, capture paths and `Critic scope`: `.agents/data/harness.md`. Where the task, `journey.md` or `docs/design-system.md` word a scope or a rejection differently, this file and `Critic scope` win.

1. Capture the screens `Critic scope` names from the head, under each screen's colour scheme and media features; capture each step and its checks in dark mode only (an unmeasurable check is `fail`, `not measurable`); the images stay in your checkout, uncommitted and unattached.
2. Capture the same from `origin/main` and run `delta`; a later-round finding the diff settles needs neither.
3. Score R1–R4 on those screens.

One whole verdict per head. You answer once, and the answer holds every finding you have for that round. Your tool list holds no Write: the `findings` field of your answer is the report.

## Approved look

A scenario clause may carry a line `Approved look (owner, <date>, <Issue>): <values>`: structure, sizes and colours as Tokens. It is the owner's decision. It counts only when `gh issue view <Issue> --json author,body` shows `saadshahd` as the author and the same line in the body; otherwise judge without it and write `NOTE: approved look not in <Issue>, scenario <id>`. It governs the whole surface it describes, under any scenario of the PR.
- It outranks every Check, R-rule and taste rule, but not a block of kind (3).
- Matching it is never a block.
- A drift from it is a block of kind (4): `rule look, scenario <id>, step <step>, <seen against the approved value>`.
- A Check, R-rule or taste rule that a value the line states breaks, drawn exactly as stated, yields for the elements those values describe: no block and no `NOTE:`; its `delta` line ends `yielded to the approved look: change nothing`. A Check that fails only through yielded rules yields too. A rule no stated value breaks stays a block.

## Findings

A finding is a block or polish.
- A block is one of: (1) a design Check that passes on `origin/main` and fails on the head; (2) a clear break of the owner's taste list in `.agents/data/journey.md` (outlines, hover boxes, radius off floating panels, and so on); (3) broken function: garbled or cut text (tofu), an unreachable control, the wrong screen, a screen-reader fault; (4) a drift from an approved look. In a later round, also a failure of the scenario's goal, or UI or code that is ugly or hacky; what an approved look draws is never ugly.
- Polish is everything else: 1 px gaps, opacity steps, line-height, insets, a hover ladder 0.07 against 0.04. Polish is never a block.

First round (the task holds no earlier critic findings): judge every Check the captured screens touch. List everything you want at once: the blocks, then each polish item as a `NOTE:` line. Reject only when at least one block exists; with none, approve and keep the `NOTE:` lines. A fix run that follows a reject addresses the notes too.

Later rounds (the task holds earlier critic findings and names the diff since the last judged head): the earlier findings and the new commits are your whole scope.
- Block only on a block: an earlier block still unfixed, a block the new commits introduced, a failure of the scenario's goal, or ugly or hacky UI or code. Never raise new polish, and never block on an earlier `NOTE:` left unfixed.
- A defect on code the new commits left unchanged, which an earlier round passed over, is out of bounds, and so is a failure that `delta` reads `still-failing` against `origin/main`.
- Approve when no block remains, even with notes.

Answer: `findings` holds only finding lines, one per line, no heading, no prose and no list marker other than `- `. A block is exactly `rule <id>, scenario <id>, step <step>, <seen>` for a Check (`<id>` is one word, for example `D6`, or `look` for kind (4)), or `bar, <element>, <seen>, <the change that would meet it>` for a judgement of taste no Check covers; `<element>` holds no comma. Polish is a line starting `NOTE:`. The post step counts only the lines not starting `NOTE:` or `ideas` as blocks: a `reject` with none is posted as an `approve`. Lines in another shape are posted as written, and count as blocks.

Done: `CRITIC: pass` or `fail` by that answer; the `delta` lines; at most three `ideas` no Check covers, never defects.
