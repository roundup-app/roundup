import type { CallStatus } from "@contracts/agent/CallStatus";
import { copy } from "./copy";
import type { Done } from "./flows";
import type { Lens } from "./lens";
import type { FlowDetail, ModuleGroup } from "./modules";
import type { DiffTarget } from "./NoteBatch";
import type { Moves } from "./moveStore";
import { entriesOf, kindWords, type Entry } from "./symbols";

/** U8032a, U8032c: where a click or Enter on an unfolded row aims the scroll: a flow's section, or a line of a file. */
export type Aim = { section: string } | { target: DiffTarget };

/** U8032a, U8032b: one row unfolded under the open item: its name, its mark, the callers it counts, the words it says aloud and the rows below it. */
export type Unfold = { value: string; name: string; mark?: "+" | "−" | undefined; callers?: { total: number; names: readonly string[] } | undefined; words: string; aim?: Aim | undefined; children: Unfold[] };

/** U8032b: `+` for an added call or function, `−` for a removed one, none for a changed or unchanged one. */
const markOf = (status: CallStatus | undefined) => status === "added" ? "+" : status === "removed" ? "−" : undefined;

const spoken = (status: CallStatus | undefined) => status === undefined || status === "unchanged" ? undefined : copy.callStatus[status];

/** U8032b: the aloud name of a row: its name, its status, and who calls it. */
const said = (name: string, ...parts: (string | undefined)[]) => parts.reduce<string>((text, part) => part ? copy.rowLabel(text, part) : text, name);

/** U7683e, U8032a: the entry of a flow, below it each changed call in call-site order (an added, removed or changed one, with that function's own calls under it), then one row for the calls that did not change; a function that makes no call and has no caller counted says it ends here, and one reached twice expands once. */
export const flowRows = (flow: FlowDetail): Unfold[] => {
  const expanded = new Set<string>();

  /** The callers a function counts: those `FunctionCalls.incoming` names, and the unchanged ones it only counts. */
  const callersOf = (key: string) => {
    const own = flow.calls.get(key);
    const total = (own?.incoming.length ?? 0) + (own?.incoming_unchanged ?? 0);

    return total > 0 ? { names: own?.incoming.map(call => call.name) ?? [], total } : undefined;
  };

  const row = (value: string, name: string, status: CallStatus | undefined, key: string | undefined, section: string | undefined, children: Unfold[]): Unfold => {
    const callers = key === undefined ? undefined : callersOf(key);

    return { value, name, mark: markOf(status), callers, words: said(name, spoken(status), callers && copy.calledBy(callers.total)), aim: section === undefined ? undefined : { section }, children };
  };

  const below = (key: string, path: string): Unfold[] => {
    expanded.add(key);

    const own = flow.calls.get(key);
    const section = flow.sections.get(key);
    const changed = (own?.outgoing ?? []).filter(call => call.status !== "unchanged");
    const quiet = (own?.outgoing.length ?? 0) - changed.length;

    const rows: Unfold[] = [
      ...changed.map((call, at) => row(`${path}.${at}`, call.name, call.status, call.key, call.status === "removed" ? section : flow.sections.get(call.key) ?? section, flow.calls.has(call.key) && !expanded.has(call.key) ? below(call.key, `${path}.${at}`) : [])),
      ...quiet > 0 ? [row(`${path}.quiet`, copy.unchangedCalls(quiet), undefined, undefined, section, [])] : [],
    ];

    return rows.length > 0 || callersOf(key) ? rows : [row(`${path}.ends`, copy.endsHere, undefined, undefined, section, [])];
  };

  const entry = flow.tree.key;

  return [row("entry", flow.symbols.get(entry)?.name ?? entry, flow.tree.status, entry, flow.sections.get(entry), below(entry, "entry"))];
};

/** U8032c: the changed functions and types of the open Logic item, one row each, with the mark of a call row and the kind, status and move aloud. */
export const symbolRows = (entries: readonly Entry[], moves: Moves): Unfold[] => entries.map((entry, at) => {
  const moved = moves.label(entry);

  return { value: `s${at}`, name: entry.name, mark: markOf(entry.status), words: said(entry.name, kindWords(entry.kind), entry.status === "changed" ? undefined : spoken(entry.status), moved === undefined ? undefined : moved === "moved" ? copy.movedWord : copy.renamedWord), aim: { target: { path: entry.path, side: entry.side, line: entry.span.start, span: entry.span } }, children: [] };
});

/** U8032a, U8032c: what the open item's row unfolds into: a flow's calls, or the changed functions and types of a Logic item; none in another lens. */
export const unfoldedRows = (lens: Lens, item: ModuleGroup, done: readonly Done[], moves: Moves): Unfold[] => lens === "flows" && item.flow ? flowRows(item.flow) : lens === "logic" ? symbolRows(entriesOf(done, item.files), moves) : [];

/** U8032a, U8032c: a click or Enter on an unfolded row opens a flow's section, or aims the scroll at a line. */
export const aimAt = (aim: Aim, section: (id: string) => void, target: (at: DiffTarget) => void) => { if ("section" in aim) section(aim.section); else target(aim.target); };
