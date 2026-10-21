import { createEffect, createMemo, createSignal, For, on, type Accessor, type JSX } from "solid-js";
import { createTreeCollection } from "@ark-ui/solid/collection";
import { TreeView } from "../ui/TreeView";
import { Icon } from "../ink/Icon";
import { Tip } from "../ui/Tip";
import { IconButton } from "../ui/IconButton";
import { copy } from "../copy";
import type { OwnerGroup } from "./scope";

type Entry = { id: string; name: string; children: Entry[] };

/** U3717, U3719: the Todos tab's groups by owner on the Rail's TreeView; each header carries a plus beside, never inside, the disclosure's control. */
export const OwnerGroups = <T,>(props: {
  groups: Accessor<readonly OwnerGroup<T>[]>;
  /** U3718: while a drag is live every owner shows, empty ones included. */
  dragging: Accessor<boolean>;
  /** U3719: the group whose new-Todo field is open; it shows and unfolds. */
  adding: Accessor<string | null>;
  /** U3720: the group a reassigned Todo arrived in; it unfolds so the row can take focus. */
  reveal: Accessor<string | null>;
  /** Each change opens the Unassigned group, so a Todo just captured shows. */
  unfold?: Accessor<number>;
  onAdd: (group: OwnerGroup<T>) => void;
  children: (group: Accessor<OwnerGroup<T>>) => JSX.Element;
}) => {
  // A Todo filed before the first group mounts has already counted: the group starts open then.
  const [closed, setClosed] = createSignal(props.unfold?.() ? [] : ["unassigned"]);

  const shown = createMemo<OwnerGroup<T>[]>((previous = []) => {
    const groups = props.groups().filter(group => group.items.length > 0 || props.dragging() || props.adding() === group.id);

    if (!props.dragging()) return groups;

    // U3710, U3718: append newly revealed targets and hold their places even when an owner's Todos change mid-drag.
    const order = new Map(previous.map((group, at) => [group.id, at]));

    return groups.toSorted((a, b) => (order.get(a.id) ?? groups.length) - (order.get(b.id) ?? groups.length));
  });

  const collection = createMemo(() => createTreeCollection<Entry>({
    rootNode: { id: "root", name: "", children: shown().map(group => ({ id: group.id, name: group.name, children: [{ id: `${group.id}:items`, name: "", children: [] }] })) },
    nodeToValue: node => node.id, nodeToString: node => node.name, isNodeDisabled: node => node.id.endsWith(":items"),
  }));

  createEffect(on([props.adding, props.reveal], ([adding, reveal]) => setClosed(held => held.filter(each => each !== adding && each !== reveal))));

  createEffect(on(() => props.unfold?.(), () => setClosed(held => held.filter(each => each !== "unassigned")), { defer: true }));

  return <TreeView.Root collection={collection()} expandedValue={collection().getBranchValues().filter(id => !closed().includes(id))} selectedValue={[]} expandOnClick
    onExpandedChange={details => {
      const branches = collection().getBranchValues();

      setClosed(held => [...held.filter(id => !branches.includes(id)), ...branches.filter(id => !details.expandedValue.includes(id))]);
    }}>
    <TreeView.Tree class="shelf-groups" aria-label={copy.shelfLabel}>
      <For each={shown().map(group => group.id)}>{(id, at) => {
        const group = () => shown().find(each => each.id === id)!;

        return <TreeView.NodeProvider node={collection().rootNode.children![at()]!} indexPath={[at()]}>
        <TreeView.Branch data-shelf-group={id}>
          <div class="shelf-group-head">
            <TreeView.BranchControl class="shelf-group-control" data-button="quiet">
              <TreeView.BranchIndicator><Icon name={closed().includes(id) ? "right" : "down"} /></TreeView.BranchIndicator>
              <TreeView.BranchText><Tip text={group().name}>{trigger => <span {...trigger()} class="shelf-group-name">{group().name}</span>}</Tip></TreeView.BranchText>
              <span class="shelf-group-count">{group().items.length}</span>
            </TreeView.BranchControl>
            <IconButton class="shelf-group-add" aria-label={copy.addTodoTo(group().name)} onKeyDown={event => event.stopPropagation()} onClick={() => props.onAdd(group())}><Icon name="plus" /></IconButton>
          </div>
          <TreeView.BranchContent>{props.children(group)}</TreeView.BranchContent>
        </TreeView.Branch>
      </TreeView.NodeProvider>; }}</For>
    </TreeView.Tree>
  </TreeView.Root>;
};
