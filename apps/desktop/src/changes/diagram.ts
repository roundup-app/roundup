import { lexer } from "marked";
import type { Account } from "@contracts/agent/Account";
import type { DiagramStop } from "@contracts/agent/DiagramStop";
import { copy } from "./copy";

/** U7688c: one call of the diagram, from a part to a part it calls. */
export type Call = readonly [from: string, to: string];

/** U7688c: a diagram's "Before" or "After" (or the whole of it, with no label): the calls it draws and the lines it keeps as words. */
export type Panel = { label: "before" | "after" | undefined; calls: Call[]; words: string[] };

const ARROW = /\s*(?:-+>|=+>|→)\s*/;

const HEADING = /^(before|after)(?:\s*:\s*(.*))?$/i;

const bare = (part: string) => part.replace(/^[-*•\s[(`]+|[\])`\s]+$/g, "");

/** U7709: the diagram's text outside its fenced `statechart` blocks, and the blocks' own text. */
const split = (text: string) => {
  const charts: string[] = [];

  const rest = lexer(text).map(token => {
    if (token.type !== "code" || token.lang?.trim().toLowerCase() !== "statechart") return token.raw;
    charts.push(token.text);

    return "";
  });

  return { text: rest.join(""), charts };
};

/** U7709: the statechart blocks the diagram holds, in the order written. */
export const chartsOf = (text: string) => split(text).charts;

/** U7688c: `Account.diagram` is free text (RB3): a line of the form `A -> B` (chained or not) is a call, a line "Before" or "After" starts a panel, and every other line stays as words. */
export const parseDiagram = (text: string): Panel[] => {
  const panels: Panel[] = [];

  for (const raw of split(text).text.split("\n")) {
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

/** U7703a: the stops of an account that name a part its diagram draws, in order, each named as `parseDiagram` names the part; a stop that names no drawn part is dropped, so the stops are only places the figure and its words can light. */
export const stopsOf = (account: Pick<Account, "diagram" | "stops">): DiagramStop[] => {
  const drawn = new Set(parseDiagram(account.diagram).flatMap(panel => partsOf(panel.calls)));

  return account.stops.flatMap(({ part, text }) => drawn.has(bare(part)) ? [{ part: bare(part), text }] : []);
};

/** U7688c, U7702e: the word a panel's label shows, none for a diagram with no "Before" or "After". */
export const panelLabel = (panel: Panel) => panel.label === "before" ? copy.diagramBefore : panel.label === "after" ? copy.diagramAfter : undefined;

/** U7688c: the parts the calls of a panel name, in order of first mention. */
export const partsOf = (calls: readonly Call[]) => [...new Set(calls.flat())];
