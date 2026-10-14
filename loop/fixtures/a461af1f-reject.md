# Critic replay: a461af1f (U162, U163), the Rail's `+ agent  + terminal`

Replayed 2026-10-12 by builder-38232208387 as a design-critic run (`.agents/design-critic.md`, gate run) on the commit's `apps/desktop/src/rail/` diff, against `docs/design-system.md` on `main`. The user called these two text buttons undesigned (#1065). This run had no built app or Percy build, so it judged the diff and the stylesheet, not harness captures.

CRITIC: reject

- bar, the `+ agent` and `+ terminal` buttons that end a Workstream's group in the Rail, two lowercase text buttons side by side (`class="word"`, a `plus` Icon and a word each) on a bare 28 px line with no icon-button frame, so the Rail's one control reads as two loose captions, the change that would meet it is one icon-only add control in the Rail's glyph column with a name and shortcut in its tooltip.
