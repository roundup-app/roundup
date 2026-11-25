import { createMemo, createSignal, For, Show } from "solid-js";
import { createTreeController, TreeItem, type TreeItemData } from "@ui-sdk/solid/tree";
import type { CallStatus } from "@contracts/agent/CallStatus";
import { Disclosure } from "../ui/Disclosure";
import { AppTree } from "../ui/TreeView";
import { Name } from "./ChangedTree";
import { copy } from "./copy";
import type { FlowDetail } from "./modules";

/** The status a row says aloud: an unchanged call says nothing. */
const changedStatus = (status: CallStatus | undefined) => status === "unchanged" ? undefined : status;

const labelOf = (row: { label: string; status?: CallStatus | undefined }) => {
  const status = changedStatus(row.status);

  return status ? copy.rowLabel(row.label, copy.callStatus[status]) : row.label;
};

/** U7683e: one row of a flow's call tree: a function or a call, the section Enter opens, and the rows below it. */
type Row = { value: string; label: string; status?: CallStatus | undefined; section?: string | undefined; children: Row[] };

/** U7683e: the flow's entry, below it each changed call in call-site order (an added, removed or changed one, with that function's own calls under it), then one row for the calls that did not change and one for its callers; a function that makes no call says it ends here, and one reached twice expands once. */
const rowsOf = (flow: FlowDetail): Row[] => {
  const expanded = new Set<string>();

  const below = (key: string, path: string): Row[] => {
    expanded.add(key);

    const own = flow.calls.get(key);
    const section = flow.sections.get(key);
    const changed = (own?.outgoing ?? []).filter(call => call.status !== "unchanged");
    const quiet = (own?.outgoing.length ?? 0) - changed.length;
    const callers = (own?.incoming.length ?? 0) + (own?.incoming_unchanged ?? 0);

    const rows: Row[] = [
      ...changed.map((call, at): Row => ({
        value: `${path}.${at}`,
        label: call.name,
        status: call.status,
        section: call.status === "removed" ? section : flow.sections.get(call.key) ?? section,
        children: flow.calls.has(call.key) && !expanded.has(call.key) ? below(call.key, `${path}.${at}`) : [],
      })),
      ...quiet > 0 ? [{ value: `${path}.quiet`, label: copy.unchangedCalls(quiet), section, children: [] }] : [],
      ...callers > 0 ? [{ value: `${path}.callers`, label: copy.calledBy(callers), section, children: [] }] : [],
    ];

    return rows.length > 0 ? rows : [{ value: `${path}.ends`, label: copy.endsHere, section, children: [] }];
  };

  const entry = flow.tree.key;

  return [{ value: "entry", label: flow.symbols.get(entry)?.name ?? entry, status: flow.tree.status, section: flow.sections.get(entry), children: below(entry, "entry") }];
};

const dataOf = (rows: readonly Row[]): TreeItemData[] => rows.map(row => {
  const item: TreeItemData = { value: row.value, label: row.label };

  if (row.children.length > 0) item.children = dataOf(row.children);

  return item;
});

/** A row and how deep it sits: the call tree draws each level one Token step in. */
const flatten = (rows: readonly Row[], open: (value: string) => boolean, depth = 0): (Row & { depth: number })[] => rows.flatMap(row => [{ ...row, depth }, ...open(row.value) ? flatten(row.children, open, depth + 1) : []]);

/** U7683e: the call tree of the open flow, above its scroll; Enter or a click on a row opens the section it names. */
export const FlowTree = (props: { flow: FlowDetail; open: (section: string) => void }) => {
  const controller = createTreeController();
  const rows = createMemo(() => rowsOf(props.flow));
  const all = createMemo(() => flatten(rows(), () => true));
  const [collapsed, setCollapsed] = createSignal<string[]>([]);
  const open = (value: string) => !collapsed().includes(value);
  const sectionOf = createMemo(() => new Map(all().map(row => [row.value, row.section])));

  return <Disclosure class="flow-tree" label={copy.callTree} defaultOpen>
    <AppTree class="flow-tree-rows" aria-label={copy.callTree} items={dataOf(rows())} controller={controller} activation="manual" expanded={all().filter(row => row.children.length > 0 && open(row.value)).map(row => row.value)} onExpandedChange={next => setCollapsed(all().filter(row => row.children.length > 0 && !next.includes(row.value)).map(row => row.value))} onValueChange={value => { const section = value === null ? undefined : sectionOf().get(value);

 if (section !== undefined) props.open(section); }}>
      <For each={flatten(rows(), open)}>{row => <TreeItem value={row.value} class="changes-row row-wash" data-row="call" data-status={row.status} data-level={row.depth} aria-label={labelOf(row)}>
        <Name text={row.label} />
        <Show when={changedStatus(row.status)}>{status => <span class="changes-row-status">{copy.callStatus[status()]}</span>}</Show>
      </TreeItem>}</For>
    </AppTree>
  </Disclosure>;
};
