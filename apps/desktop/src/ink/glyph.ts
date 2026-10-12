import type { Kind } from "@contracts/Kind";

type Tone = "amber" | "red" | "grey" | "accent";

type Shape = "ring" | "dashed" | "quarter" | "disc" | "cross" | "check";

type Glyph = { shape: Shape; tone: Tone };

const GLYPHS: Record<Kind, Glyph> = {
  "needs-you": { shape: "disc", tone: "amber" },
  error: { shape: "cross", tone: "red" },
  blocked: { shape: "dashed", tone: "grey" },
  working: { shape: "quarter", tone: "accent" },
  idle: { shape: "ring", tone: "grey" },
  done: { shape: "check", tone: "grey" },
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

export const hasInk = (glyph: Glyph): boolean => glyph.tone === "amber" || glyph.tone === "red";

export const mostUrgent = (kinds: readonly Kind[]): Kind | null =>
  kinds.reduce<Kind | null>(
    (best, kind) => (best === null || URGENCY_RANK[kind] < URGENCY_RANK[best] ? kind : best),
    null,
  );
