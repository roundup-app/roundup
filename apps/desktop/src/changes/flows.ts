import type { Account } from "@contracts/agent/Account";
import type { CallPathsAnswer } from "@contracts/agent/CallPathsAnswer";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { ChangedSymbol } from "@contracts/agent/ChangedSymbol";
import type { FlowNode } from "@contracts/agent/FlowNode";
import type { ReadFlow } from "@contracts/agent/ReadFlow";
import { copy } from "./copy";
import { groupModules, noiseOf, scrollOrder, type Grouped, type ModuleGroup, type Takes, type Section } from "./modules";

/** U7683c: one language's finished trace. */
export type Done = Extract<CallPathsAnswer, { state: "done" }>;

/** U7689: the readback a list is drawn from, and whether the diff has moved under it. */
export type Read = { account: Account; stale: boolean };

/** U7683c: an item's name: the flow of an entry point, and the two items that follow the flows. A tilde starts none of a module's names. */
export const flowName = (entry: string) => `~flow:${entry}`;

/** U7689b: the item of a flow the readback added. */
const readName = (id: string) => `~read:${id}`;

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

/** U7689b: the path of a hunk id, `<path>#<n>`: the only part of it the diff reader's hunks share (GLOSSARY: Hunk id). */
const pathOf = (hunk: string) => hunk.slice(0, hunk.lastIndexOf("#"));

/** U7689a, U7689b: the files a readback flow's steps name, in step order, each once. */
const filesOf = (flow: ReadFlow) => [...new Set(flow.steps.flatMap(step => step.hunks.map(pathOf)))];

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
 * U7689: a readback names the code's flows (`code-N` is the Nth flow of the traces, in the trace's order, and its name applies only when its hunks sit in the files the flow lists), adds its own flows after them, and replaces Unplaced and Not traced with the files of its unplaced hunks.
 */
export const groupFlows = (files: readonly ChangedFile[], done: readonly Done[], read?: Read): Grouped => {
  const listed = new Map(files.flatMap(file => noiseOf(file.path) === undefined ? [[file.path, file] as const] : []));
  const symbols = new Map(done.flatMap(answer => answer.symbols.map(symbol => [symbol.key, symbol] as const)));
  const calls = new Map(done.flatMap(answer => answer.calls.map(call => [call.key, call] as const)));
  const byId = new Map((read?.account.flows ?? []).map(flow => [flow.id, flow]));
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
  })).map((each, at) => {
    const given = byId.get(`code-${at + 1}`);
    const own = each.item.files.map(file => file.path);
    const theirs = given ? filesOf(given) : [];

    if (!read || given?.source !== "code" || theirs.length !== own.length || !theirs.every(path => own.includes(path))) return each;

    return { ...each, item: { ...each.item, label: given.name, function: each.entry.name, read: { notes: given.steps.map(step => step.note), added: false, stale: read.stale } } };
  }).sort((a, b) => a.entry.path.localeCompare(b.entry.path, undefined, { numeric: true }) || (a.entry.new?.start ?? a.entry.old?.start ?? 0) - (b.entry.new?.start ?? b.entry.old?.start ?? 0));

  const loose = distinct(read ? read.account.unplaced.flatMap(hunk => {
    const file = listed.get(pathOf(hunk));

    return file ? [{ id: file.path, file }] : [];
  }) : [...symbols.values()].flatMap(symbol => {
    const file = listed.get(symbol.path);

    return placed.has(symbol.key) || !file ? [] : [{ id: symbol.path, file }];
  }));

  const added = (read?.account.flows ?? []).flatMap(flow => {
    const own = flow.source === "readback" ? filesOf(flow).flatMap(path => listed.get(path) ?? []) : [];

    return own.length > 0 ? [itemOf(readName(flow.id), flow.name, own, { sections: own.map(file => ({ id: file.path, file })), read: { notes: flow.steps.map(step => step.note), added: true, stale: read?.stale ?? false } })] : [];
  });

  const unplaced = scrollOrder(loose).map((file): Section => ({ id: file.path, file, pick: (side, line) => !(taken.get(file.path) ?? []).some(pick => pick(side, line)) }));
  const named = new Set([...symbols.values()].map(symbol => symbol.path));
  const rest = scrollOrder([...listed.values()].filter(file => !named.has(file.path)));

  return {
    modules: [
      ...flows.map(each => each.item),
      ...added,
      ...unplaced.length > 0 ? [itemOf(UNPLACED, copy.unplaced, unplaced.map(section => section.file), { sections: unplaced, ...read && { read: { notes: [], added: false, stale: read.stale } } })] : [],
      ...rest.length > 0 && !read ? [itemOf(UNTRACED, copy.notTraced, rest, { untraced: true })] : [],
    ],
    noise: groupModules(files).noise,
  };
};
