import type { CallPathsAnswer } from "@contracts/agent/CallPathsAnswer";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { ChangedSymbol } from "@contracts/agent/ChangedSymbol";
import type { FlowNode } from "@contracts/agent/FlowNode";
import { copy } from "./copy";
import { groupModules, noiseOf, scrollOrder, type Grouped, type ModuleGroup, type Takes, type Section } from "./modules";

/** U7683c: one language's finished trace. */
export type Done = Extract<CallPathsAnswer, { state: "done" }>;

/** U7683c: an item's name: the flow of an entry point, and the two items that follow the flows. A tilde starts none of a module's names. */
export const flowName = (entry: string) => `~flow:${entry}`;

const UNPLACED = "~unplaced";

const UNTRACED = "~untraced";

/** U7683d: a function's section in its file, keyed by the symbol. */
const sectionId = (symbol: ChangedSymbol) => `${symbol.path}\0${symbol.key}`;

/** U7683d: a changed line is a function's when it sits in its new span, or in its old span for a line the change removed. */
const within = (symbol: ChangedSymbol): Takes => (side, line) => {
  const span = side === "old" ? symbol.old : symbol.new;

  return span !== null && span.start <= line && line <= span.end;
};

/** U7683d: the function keys of a flow's tree depth-first, callees in call-site order, each function once, at its first place. */
const callOrder = (node: FlowNode, seen: Set<string> = new Set()): string[] => {
  if (seen.has(node.key)) return [];
  seen.add(node.key);

  return [node.key, ...node.calls.flatMap(call => callOrder(call, seen))];
};

const itemOf = (name: string, label: string, files: ChangedFile[], rest: Partial<ModuleGroup>): ModuleGroup => ({
  name,
  label,
  files,
  total: files.length,
  added: files.reduce((sum, file) => sum + (file.counts?.added ?? 0), 0),
  removed: files.reduce((sum, file) => sum + (file.counts?.removed ?? 0), 0),
  counted: files.some(file => file.counts !== null),
  ...rest,
});

const distinct = (sections: readonly Section[]) => [...new Map(sections.map(section => [section.file.path, section.file])).values()];

/**
 * U7683c: the Flows list: a flow for each entry point of the finished traces in path order, then Unplaced (the files of symbols no flow holds, minus the hunks the flows show), then Not traced (every file no trace names), then the noise rows as in the other lenses.
 * A file belongs to a language only when a trace's symbols name it: the App reads no extension.
 */
export const groupFlows = (files: readonly ChangedFile[], done: readonly Done[]): Grouped => {
  const listed = new Map(files.flatMap(file => noiseOf(file.path) === undefined ? [[file.path, file] as const] : []));
  const symbols = new Map(done.flatMap(answer => answer.symbols.map(symbol => [symbol.key, symbol] as const)));
  const calls = new Map(done.flatMap(answer => answer.calls.map(call => [call.key, call] as const)));
  const placed = new Set<string>();
  const taken = new Map<string, Takes[]>();

  const flows = done.flatMap(answer => answer.flows.flatMap(flow => {
    const entry = symbols.get(flow.entry);
    const keys = callOrder(flow.tree);

    const made = keys.flatMap((key): [string, Section][] => {
      const symbol = symbols.get(key);
      const file = symbol && listed.get(symbol.path);

      return symbol && file ? [[key, { id: sectionId(symbol), file, label: symbol.name, pick: within(symbol) }]] : [];
    });

    const sections = made.map(([, section]) => section);

    if (!entry || sections.length === 0) return [];

    for (const key of keys) placed.add(key);

    for (const section of sections) if (section.pick) taken.set(section.file.path, [...taken.get(section.file.path) ?? [], section.pick]);

    return [{ entry, item: itemOf(flowName(flow.entry), entry.name, distinct(sections), { sections, flow: { tree: flow.tree, symbols, calls, sections: new Map(made.map(([key, section]) => [key, section.id])) } }) }];
  })).sort((a, b) => a.entry.path.localeCompare(b.entry.path, undefined, { numeric: true }) || (a.entry.new?.start ?? a.entry.old?.start ?? 0) - (b.entry.new?.start ?? b.entry.old?.start ?? 0));

  const loose = distinct([...symbols.values()].flatMap(symbol => {
    const file = listed.get(symbol.path);

    return placed.has(symbol.key) || !file ? [] : [{ id: symbol.path, file }];
  }));

  const unplaced = scrollOrder(loose).map((file): Section => ({ id: file.path, file, pick: (side, line) => !(taken.get(file.path) ?? []).some(pick => pick(side, line)) }));
  const named = new Set([...symbols.values()].map(symbol => symbol.path));
  const rest = scrollOrder([...listed.values()].filter(file => !named.has(file.path)));

  return {
    modules: [
      ...flows.map(each => each.item),
      ...unplaced.length > 0 ? [itemOf(UNPLACED, copy.unplaced, unplaced.map(section => section.file), { sections: unplaced })] : [],
      ...rest.length > 0 ? [itemOf(UNTRACED, copy.notTraced, rest, {})] : [],
    ],
    noise: groupModules(files).noise,
  };
};
