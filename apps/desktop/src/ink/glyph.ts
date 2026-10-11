import type { Kind } from "@contracts/Kind";

type Tone = "amber" | "red" | "grey" | "accent";

/** U396: the six shapes, one per Kind; the first two are solid masses. */
export type Form = "square-x" | "disc-bang" | "bars" | "arc" | "dot" | "check";

type Glyph = { form: Form; tone: Tone };

const GLYPHS: Record<Kind, Glyph> = {
  "needs-you": { form: "disc-bang", tone: "amber" },
  error: { form: "square-x", tone: "red" },
  blocked: { form: "bars", tone: "grey" },
  working: { form: "arc", tone: "accent" },
  idle: { form: "dot", tone: "grey" },
  done: { form: "check", tone: "grey" },
};

/** Most urgent first, as listed under Kind in GLOSSARY.md; the type forces every Kind to have a rank. */
const URGENCY_RANK: Record<Kind, number> = {
  error: 0,
  "needs-you": 1,
  blocked: 2,
  working: 3,
  idle: 4,
  done: 5,
};

export const glyphOf = (kind: Kind): Glyph => GLYPHS[kind];

/** Ink is the solid shapes, which are exactly the red and amber ones (U396). */
export const hasInk = (glyph: Glyph): boolean => glyph.form === "square-x" || glyph.form === "disc-bang";

export const mostUrgent = (kinds: readonly Kind[]): Kind | null =>
  kinds.reduce<Kind | null>(
    (best, kind) => (best === null || URGENCY_RANK[kind] < URGENCY_RANK[best] ? kind : best),
    null,
  );
