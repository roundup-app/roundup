import { lexer, type Token, type Tokens } from "marked";
import { copy } from "./copy";

/** `title` is the plain words (what matching and names read); `marks` are the heading's inline tokens, drawn by the outline and the step heading. */
export type WalkStep = { title: string; text: string; marks: Tokens.Generic[] };

const words = (tokens: readonly Tokens.Generic[]): string => tokens.map(token => token.tokens ? words(token.tokens) : token.text ?? token.raw).join("");

const named = (title: string): Tokens.Generic[] => [{ type: "text", raw: title, text: title }];

/** PW1: a Pad's steps. The section level is the shallowest heading level the Pad uses at least twice; each heading of that level with the text under it up to the next one is a step. One heading above that level at the very top is the Pad's title and makes no step, text before the first section is the step "Overview", and a Pad with no level used twice is one step named `name`. A heading in a fenced code block does not count, because `marked` reads it as code. */
export const walkSteps = (text: string, name: string): WalkStep[] => {
  const tokens = lexer(text);
  const uses = new Map<number, number>();

  for (const token of tokens) if (token.type === "heading") uses.set(token.depth, (uses.get(token.depth) ?? 0) + 1);

  const level = [...uses].flatMap(([depth, count]) => count >= 2 ? [depth] : []).sort((a, b) => a - b)[0];

  if (level === undefined) return [{ title: name, text, marks: named(name) }];

  const first = tokens.findIndex(token => token.type !== "space");
  const head = tokens[first];
  const titled = head?.type === "heading" && head.depth < level;
  const steps: { marks: Tokens.Generic[]; raw: string }[] = [];
  let before = "";

  tokens.forEach((token: Token, at) => {
    const last = steps.at(-1);

    if (titled && at === first) return;

    // SAFETY: a heading's inline tokens are generic tokens, with the text and children the outline reads.
    const inline = (token.type === "heading" ? token.tokens : []) as Tokens.Generic[];

    if (token.type === "heading" && token.depth === level) steps.push({ marks: words(inline).trim() ? inline : named(name), raw: "" });
    else if (last) last.raw += token.raw;
    else before += token.raw;
  });

  const overview = before.trim() === "" ? [] : [{ title: copy.walkOverview, text: before.trim(), marks: named(copy.walkOverview) }];

  return [...overview, ...steps.map(step => ({ title: words(step.marks).trim(), text: step.raw.trim(), marks: step.marks }))];
};

const plain = (text: string) => text.replace(/^#+/, "").split(/\s+/).filter(Boolean).join(" ").toLowerCase();

/** PW11, PW12: the index of the first step that holds a heading reading `heading` (case and whitespace as P15 reads it), or -1. */
export const stepOfHeading = (steps: readonly WalkStep[], heading: string): number => {
  const wanted = plain(heading);

  return steps.findIndex(step => plain(step.title) === wanted || lexer(step.text).some(token => token.type === "heading" && plain(token.text) === wanted));
};
