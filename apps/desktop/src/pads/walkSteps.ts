export type WalkStep = { title: string; text: string };

const FENCE = /^\s*(```|~~~)/;

const TOP_HEADING = /^#[ \t]+(\S.*?)[ \t#]*$/;

/** PW1: a Pad's steps. Each top-level `#` heading with its text up to the next one is a step; text before the first heading joins step 1; a Pad with none is one step named `name`. A heading in a fenced code block does not split. */
export const walkSteps = (text: string, name: string): WalkStep[] => {
  const steps: { title: string; lines: string[] }[] = [];
  let before: string[] = [];
  let fenced = false;

  for (const line of text.split("\n")) {
    if (FENCE.test(line)) fenced = !fenced;

    const heading = fenced ? null : TOP_HEADING.exec(line);

    if (heading) steps.push({ title: heading[1] ?? name, lines: steps.length === 0 ? [...before, line] : [line] });
    else (steps.at(-1)?.lines ?? before).push(line);
  }

  if (steps.length === 0) return [{ title: name, text }];

  return steps.map(step => ({ title: step.title, text: step.lines.join("\n") }));
};
