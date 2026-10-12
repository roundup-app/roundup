import type { Kind } from "@contracts/Kind";

type Tone = "amber" | "red" | "grey" | "accent";

type Drawing = "ring" | "dashed" | "quarter" | "disc" | "cross" | "check";

type Glyph = { drawing: Drawing; tone: Tone };

const GLYPHS: Record<Kind, Glyph> = {
  "needs-you": { drawing: "disc", tone: "amber" },
  error: { drawing: "cross", tone: "red" },
  blocked: { drawing: "dashed", tone: "grey" },
  working: { drawing: "quarter", tone: "accent" },
  idle: { drawing: "ring", tone: "grey" },
  done: { drawing: "check", tone: "grey" },
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
