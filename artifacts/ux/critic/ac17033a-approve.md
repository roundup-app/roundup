# Critic replay: ac17033a (U392), the Agent add as an icon button

Replayed 2026-10-12 by builder-38232208387 as a design-critic run (`.agents/design-critic.md`, gate run) on the commit's `apps/desktop/src/rail/` diff, against `docs/design-system.md` on `main`. It is the change the user asked for in #1065. This run had no built app or Percy build, so it judged the diff and the stylesheet, not harness captures.

CRITIC: approve

NOTE: the icon button takes `data-button="icon"` and `--space-5`, the Tokens D2 reads; its inset is derived from the mark's column, so the `plus` aligns with its siblings' Glyphs.
NOTE: `aria-label` and `title="add agent ⌘N"` give the icon a name and the chord.
