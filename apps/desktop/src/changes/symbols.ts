import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { ChangedSymbol } from "@contracts/agent/ChangedSymbol";
import type { LineSpan } from "@contracts/agent/LineSpan";
import type { Done } from "./flows";

/** U7695a: one changed function or type of an item: its name, kind and status, and where its change begins. */
export type Entry = { name: string; kind: string; status: ChangedSymbol["status"]; path: string; side: "old" | "new"; span: LineSpan };

/** U7695a: a name the server leaves for what it cannot name: `<function>`, `<class>`, `map() callback`. */
const anonymous = (segment: string) => /^<.*>$|callback$/.test(segment);

/** U7695a: the containers and name of a symbol joined by dots, read from its key (`path#containers#name#kind`), without the anonymous ones. */
const nameOf = (symbol: ChangedSymbol) => {
  const containers = symbol.key.slice(symbol.path.length + 1, symbol.key.length - symbol.name.length - symbol.kind.length - 2);

  return [...containers.split("."), symbol.name].filter(segment => segment !== "" && !anonymous(segment)).join(".");
};

/** U7695a: a removed symbol lives on the old side only; any other on the new side, else the old. */
const placeOf = (symbol: ChangedSymbol) => {
  const side = symbol.status === "removed" || symbol.new === null ? "old" : "new";
  const span = symbol[side];

  return span === null ? [] : [{ side, span } as const];
};

/** U7695a: the changed functions and types of the finished traces that sit in `files`: each once by file and name, in the files' order and then by line; a top-level hunk has none. */
export const entriesOf = (answers: readonly Done[], files: readonly ChangedFile[]): Entry[] => {
  const byName = new Map<string, Entry>();

  for (const symbol of answers.flatMap(answer => answer.symbols)) {
    const name = nameOf(symbol);
    const [place] = placeOf(symbol);

    if (symbol.kind === "topLevel" || name === "" || !place || !files.some(file => file.path === symbol.path)) continue;

    const key = [symbol.path, name].join("\0");
    const kept = byName.get(key);

    if (!kept) byName.set(key, { name, kind: symbol.kind, status: symbol.status, path: symbol.path, ...place });
    else if (kept.side === place.side) kept.span = { start: Math.min(kept.span.start, place.span.start), end: Math.max(kept.span.end, place.span.end) };
  }

  return [...byName.values()].sort((a, b) => files.findIndex(file => file.path === a.path) - files.findIndex(file => file.path === b.path) || a.span.start - b.span.start);
};

/** U7695a: a kind in words: `enumMember` reads "enum member". */
export const kindWords = (kind: string) => kind.replace(/[A-Z]/g, letter => " " + letter.toLowerCase());
