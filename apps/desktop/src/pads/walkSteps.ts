import { lexer } from "marked";

export type WalkStep = { title: string; text: string };

/** PW1: a Pad's steps. Each top-level `#` heading with its text up to the next one is a step; text before the first heading joins step 1; a Pad with none is one step named `name`. A heading in a fenced code block does not split, because `marked` reads it as code. */
export const walkSteps = (text: string, name: string): WalkStep[] => {
  const steps: { title: string; raw: string }[] = [];
  let before = "";

  for (const token of lexer(text)) {
    const last = steps.at(-1);

    if (token.type === "heading" && token.depth === 1) steps.push({ title: token.text || name, raw: last ? token.raw : before + token.raw });
    else if (last) last.raw += token.raw;
    else before += token.raw;
  }

  if (steps.length === 0) return [{ title: name, text }];

  return steps.map(step => ({ title: step.title, text: step.raw.trimEnd() }));
};
