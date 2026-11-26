import { lexer, type Token } from "marked";
import { copy } from "./copy";

export type WalkStep = { title: string; text: string };

/** PW1: a Pad's steps. The section level is the shallowest heading level the Pad uses at least twice; each heading of that level with the text under it up to the next one is a step. One heading above that level at the very top is the Pad's title and makes no step, text before the first section is the step "Overview", and a Pad with no level used twice is one step named `name`. A heading in a fenced code block does not count, because `marked` reads it as code. */
export const walkSteps = (text: string, name: string): WalkStep[] => {
  const tokens = lexer(text);
  const uses = new Map<number, number>();

  for (const token of tokens) if (token.type === "heading") uses.set(token.depth, (uses.get(token.depth) ?? 0) + 1);

  const level = [...uses].flatMap(([depth, count]) => count >= 2 ? [depth] : []).sort((a, b) => a - b)[0];

  if (level === undefined) return [{ title: name, text }];

  const first = tokens.findIndex(token => token.type !== "space");
  const head = tokens[first];
  const titled = head?.type === "heading" && head.depth < level;
  const steps: { title: string; raw: string }[] = [];
  let before = "";

  tokens.forEach((token: Token, at) => {
    const last = steps.at(-1);

    if (titled && at === first) return;

    if (token.type === "heading" && token.depth === level) steps.push({ title: token.text || name, raw: "" });
    else if (last) last.raw += token.raw;
    else before += token.raw;
  });

  const overview = before.trim() === "" ? [] : [{ title: copy.walkOverview, text: before.trim() }];

  return [...overview, ...steps.map(step => ({ title: step.title, text: step.raw.trim() }))];
};

const plain = (text: string) => text.replace(/^#+/, "").split(/\s+/).filter(Boolean).join(" ").toLowerCase();

/** PW11, PW12: the index of the first step that holds a heading reading `heading` (case and whitespace as P15 reads it), or -1. */
export const stepOfHeading = (steps: readonly WalkStep[], heading: string): number => {
  const wanted = plain(heading);

  return steps.findIndex(step => plain(step.title) === wanted || lexer(step.text).some(token => token.type === "heading" && plain(token.text) === wanted));
};
