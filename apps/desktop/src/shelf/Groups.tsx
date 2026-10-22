import { createEffect, createMemo, createSignal, For, on, Show, type Accessor, type JSX } from "solid-js";
import { createTreeCollection } from "@ark-ui/solid/collection";
import { TreeView } from "../ui/TreeView";
import { Icon } from "../ink/Icon";
import { useConnectedProject } from "../state/connectedProject";
import { shelfGroups, type ShelfGroup } from "./scope";
import type { Actor } from "@contracts/Actor";
import { copy } from "../copy";

/** The Rail's TreeView owns disclosure clicks, focus and arrow keys for Shelf groups. */
export const Groups = <T,>(props: { items: Accessor<readonly T[]>; isUngrouped?: (item: T) => boolean; home: (item: T) => string | null; maker: (item: T) => Actor; /** Each change opens the Unassigned group, so a Todo just filed shows. */ unfold?: Accessor<number>; children: (items: Accessor<T[]>) => JSX.Element }) => {
  const connected = useConnectedProject();
  const all = createMemo(() => shelfGroups(connected, props.items().filter(item => !props.isUngrouped?.(item)), props.home, props.maker));
  const selected = () => connected.rail.nodes.find(node => node.id === connected.rail.selected());
  /** U3730: the selected Workstream's own items read under the scope line, with no header repeating its name. */
  const own = createMemo(() => selected()?.kind === "workstream" ? all().find(group => group.id === selected()!.id) : undefined);
  const groups = createMemo(() => own() ? own()!.children : all());
  const [closed, setClosed] = createSignal(["unassigned"]);

  createEffect(on(() => props.unfold?.(), () => setClosed(held => held.filter(id => id !== "unassigned")), { defer: true }));

  type Entry = { id: string; name: string; children: Entry[] };

  const entry = (group: ShelfGroup<T>): Entry => ({ id: group.id, name: group.name, children: [...group.children.map(entry), ...(group.items.length ? [{ id: `${group.id}:items`, name: "", children: [] }] : [])] });
  const collection = createMemo(() => createTreeCollection<Entry>({ rootNode: { id: "root", name: "", children: groups().map(entry) }, nodeToValue: node => node.id, nodeToString: node => node.name, isNodeDisabled: node => node.id.endsWith(":items") }));

  const byId = createMemo(() => {
    const map = new Map<string, ShelfGroup<T>>();
    const visit = (group: ShelfGroup<T>) => { map.set(group.id, group); group.children.forEach(visit); };

    groups().forEach(visit);

    return map;
  });

  const branch = (id: string, path: Accessor<number[]>): JSX.Element => {
    const group = () => byId().get(id)!;

    return <TreeView.NodeProvider node={entry(group())} indexPath={path()}>
      <TreeView.Branch data-shelf-group={id}>
        <TreeView.BranchControl class="shelf-group-control" data-button="quiet">
          <TreeView.BranchIndicator><Icon name={closed().includes(id) ? "right" : "down"} /></TreeView.BranchIndicator>
          <TreeView.BranchText>{group().name}</TreeView.BranchText>
        </TreeView.BranchControl>
        <TreeView.BranchContent>
          {props.children(() => group().items)}
          <For each={group().children.map(child => child.id)}>{(child, at) => branch(child, () => [...path(), at()])}</For>
        </TreeView.BranchContent>
      </TreeView.Branch>
    </TreeView.NodeProvider>;
  };

  return <>
    <Show when={own()?.items.length}>{props.children(() => own()!.items)}</Show>
    <Show when={props.items().some(item => props.isUngrouped?.(item))}>{props.children(() => props.items().filter(item => props.isUngrouped?.(item)))}</Show>
    <Show when={groups()[0]?.id !== "flat"} fallback={props.children(() => props.items().filter(item => !props.isUngrouped?.(item)))}>
    <TreeView.Root collection={collection()} expandedValue={collection().getBranchValues().filter(id => !closed().includes(id))} selectedValue={[]} expandOnClick
      onExpandedChange={details => {
        const branches = collection().getBranchValues();

        setClosed(held => [...held.filter(id => !branches.includes(id)), ...branches.filter(id => !details.expandedValue.includes(id))]);
      }}>
      <TreeView.Tree class="shelf-groups" aria-label={copy.shelfLabel}>
        <For each={groups().map(group => group.id)}>{(id, at) => branch(id, () => [at()])}</For>
      </TreeView.Tree>
    </TreeView.Root>
  </Show></>;
};
