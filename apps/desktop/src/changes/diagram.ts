/** U7688c: one call of the diagram, from a part to a part it calls. */
export type Call = readonly [from: string, to: string];

/** U7688c: a diagram's "Before" or "After" (or the whole of it, with no label): the calls it draws and the lines it keeps as words. */
export type Panel = { label: "before" | "after" | undefined; calls: Call[]; words: string[] };

const ARROW = /\s*(?:-+>|=+>|→)\s*/;

const HEADING = /^(before|after)(?:\s*:\s*(.*))?$/i;

const bare = (part: string) => part.replace(/^[-*•\s[(`]+|[\])`\s]+$/g, "");

/** U7688c: `Account.diagram` is free text (RB3): a line of the form `A -> B` (chained or not) is a call, a line "Before" or "After" starts a panel, and every other line stays as words. */
export const parseDiagram = (text: string): Panel[] => {
  const panels: Panel[] = [];

  for (const raw of text.split("\n")) {
    const heading = HEADING.exec(raw.trim());
    const line = heading ? heading[2] ?? "" : raw.trim();

    if (heading) panels.push({ label: heading[1]?.toLowerCase() === "before" ? "before" : "after", calls: [], words: [] });

    if (line === "") continue;

    const panel = panels.at(-1) ?? panels[panels.push({ label: undefined, calls: [], words: [] }) - 1];
    const parts = line.split(ARROW).map(bare);

    if (parts.length > 1 && parts.every(part => part !== "")) panel?.calls.push(...parts.slice(1).map((to, at): Call => [parts[at] ?? "", to]));
    else panel?.words.push(line);
  }

  return panels;
};

/** U7688c: the parts the calls of a panel name, in order of first mention. */
export const partsOf = (calls: readonly Call[]) => [...new Set(calls.flat())];
