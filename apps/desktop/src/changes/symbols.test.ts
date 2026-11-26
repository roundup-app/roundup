import { expect, it } from "vitest";
import type { ChangedSymbol } from "@contracts/agent/ChangedSymbol";
import type { Done } from "./flows";
import { entriesOf } from "./symbols";
import { counted } from "./viewHarness";

// U7695a: a name read from the server's symbols.

const PATH = "apps/a/src/run.ts";

const symbol = (containers: string, name: string, kind: string, start: number, end: number): ChangedSymbol => ({ key: `${PATH}#${containers}#${name}#${kind}`, name, kind, path: PATH, old: { start, end }, new: { start, end }, status: "changed", callable: true });

const answer = (symbols: ChangedSymbol[]): Done => ({ state: "done", symbols, calls: [], flows: [], capped: false, oldSideResolvedThroughNewDependencies: false });

it("u7695a_a_name_drops_anonymous_segments_and_a_top_level_hunk_has_no_entry", () => {
  const entries = entriesOf([answer([
    symbol("", "(top level)", "topLevel", 1, 40),
    symbol("run", "<function>", "function", 3, 5),
    symbol("run.<function>", "map() callback", "function", 4, 4),
    symbol("Reader.<class>", "form", "property", 12, 12),
    symbol("run", "<function>", "function", 9, 11),
    symbol("run.<function>", "<arrow>", "variable", 14, 14),
    symbol("", "<function>", "function", 20, 22),
    symbol("", "Alias", "enumMember", 30, 31),
  ])], [counted(PATH, 1, 1)]);

  // The callbacks of `run`, whatever their kind, are one entry, spanning all; a name with nothing named in it has none.
  expect(entries.map(({ name, kind, span }) => ({ name, kind, span }))).toEqual([
    { name: "run", kind: "function", span: { start: 3, end: 14 } },
    { name: "Reader.form", kind: "property", span: { start: 12, end: 12 } },
    { name: "Alias", kind: "enumMember", span: { start: 30, end: 31 } },
  ]);
});
