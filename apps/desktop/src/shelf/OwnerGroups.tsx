import { createEffect, createMemo, createSignal, For, on, type Accessor, type JSX } from "solid-js";
import { createTreeCollection } from "@ark-ui/solid/collection";
import { TreeView } from "../ui/TreeView";
import { Icon } from "../ink/Icon";
import { Tip } from "../ui/Tip";
import { copy } from "../copy";
import { captureFocus } from "../keys/focus";
import type { OwnerGroup } from "./scope";

type Entry = { id: string; name: string; children: Entry[] };

/** Nonempty owner groups use the existing TreeView so explicit folds survive item refetches. */
export const OwnerGroups = <T,>(props: {
  groups: Accessor<readonly OwnerGroup<T>[]>;
  /** A drag preserves the order of its nonempty destinations. */
  dragging: Accessor<boolean>;
  /** A list may retain finishing rows while its count already reflects the refetched state. */
  detail?: (group: OwnerGroup<T>) => JSX.Element;
  target?: Accessor<string | null>;
  mark?: (group: OwnerGroup<T>) => JSX.Element;
  count?: (group: OwnerGroup<T>) => number;
  /** U3720: the group a reassigned Todo arrived in; it unfolds so the row can take focus. */
  reveal: Accessor<string | null>;
  arrivals?: Accessor<readonly string[]>;
  /** A Todo filed before groups first mount starts its new group expanded. */
  unfold?: Accessor<number>;
  /** U4457: the group a Rail Agent's Pads control asks for; it unfolds, scrolls into view and takes focus, then `onFocused` ends the request. */
  focus?: Accessor<string | null>;
  /** A Todo request lands on the first counted item rather than its owner's header. */
  focusItem?: () => HTMLElement | null;
  onFocused?: () => void;
  /** U3730: the group named like the scope (a selected Agent's own) shows no header, so the scope's name appears once. */
  bare?: Accessor<string | null>;
  /** U3770: completion effects only play in expanded groups. */
  onClosedChange?: (ids: readonly string[]) => void;
  children: (group: Accessor<OwnerGroup<T>>) => JSX.Element;
}) => {
  // A Todo filed before the first group mounts has already counted: the group starts open then.
  const [closed, setClosed] = createSignal<string[]>(!props.unfold?.() && !props.arrivals?.().includes("unassigned") && props.focus?.() !== "unassigned" && props.groups().some(group => group.id === "unassigned" && group.items.length > 0) ? ["unassigned"] : []);

  createEffect(() => props.onClosedChange?.(closed()));

  const shown = createMemo<OwnerGroup<T>[]>((previous = []) => {
    const nonempty = (groups: readonly OwnerGroup<T>[]): OwnerGroup<T>[] => groups.flatMap(group => {
      const children = nonempty(group.children ?? []);

      return group.items.length > 0 || children.length > 0 ? [{ ...group, children }] : [];
    });

    const groups = nonempty(props.groups());

    if (!props.dragging()) return groups;

    // U3710, U3718: append newly revealed targets and hold their places even when an owner's Todos change mid-drag.
    const order = new Map(previous.map((group, at) => [group.id, at]));

    return groups.toSorted((a, b) => (order.get(a.id) ?? groups.length) - (order.get(b.id) ?? groups.length));
  });

  const allGroups = () => shown().flatMap(group => [group, ...(group.children ?? [])]);
  const entry = (group: OwnerGroup<T>): Entry => ({ id: group.id, name: group.name, children: [...(group.items.length ? [{ id: `${group.id}:items`, name: "", children: [] }] : []), ...(group.children ?? []).map(entry)] });
  const total = (group: OwnerGroup<T>): number => group.items.length + (group.children ?? []).reduce((sum, child) => sum + total(child), 0);

  const collection = createMemo(() => createTreeCollection<Entry>({
    rootNode: { id: "root", name: "", children: shown().map(entry) },
    nodeToValue: node => node.id, nodeToString: node => node.name, isNodeDisabled: node => node.id.endsWith(":items"),
  }));

  createEffect(on([props.reveal, () => props.arrivals?.() ?? []], ([reveal, arrivals]) => setClosed(kept => kept.filter(each => each !== reveal && !arrivals.includes(each)))));

  createEffect(() => {
    const id = props.focus?.();

    if (id === null || id === undefined || !allGroups().some(group => group.id === id)) return;
    setClosed(kept => kept.filter(each => each !== id && !shown().some(group => group.id === each && group.children?.some(child => child.id === id))));
    const focus = captureFocus();

    // Ark Collapsible applies its controlled open state before the next paint; a hidden Todo cannot take native focus.
    requestAnimationFrame(() => focus(() => {
      if (props.focus?.() !== id) return;
      const branch = document.querySelector<HTMLElement>(`[data-shelf-group="${CSS.escape(id)}"]`);
      const target = props.focusItem?.() ?? branch?.querySelector<HTMLElement>(".shelf-group-head:not([hidden]) .shelf-group-control") ?? branch?.querySelector<HTMLElement>("[role=treeitem] button, button");

      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
      props.onFocused?.();
    }));
  });

  const branches = (groups: Accessor<readonly OwnerGroup<T>[]>, path: Accessor<number[]>, offset: Accessor<number> = () => 0): JSX.Element => (
    <For each={groups().map(group => group.id)}>{(id, at) => {
        const group = () => groups().find(each => each.id === id)!;
        const indexPath = () => [...path(), at() + offset()];

        return <TreeView.NodeProvider node={entry(group())} indexPath={indexPath()}>
        <TreeView.Branch data-shelf-group={id} data-drop-target={props.target?.() === id ? "" : undefined}>
          <div class="shelf-group-head" hidden={props.bare?.() === id}>
            <TreeView.BranchControl class="shelf-group-control row-wash" data-button="quiet">
              <TreeView.BranchIndicator><Icon name={closed().includes(id) ? "right" : "down"} /></TreeView.BranchIndicator>
              <TreeView.BranchText><Tip text={group().name}>{trigger => <span {...trigger()} class="shelf-group-name">{group().name}</span>}</Tip></TreeView.BranchText>
              <span class="shelf-group-count" data-state="">{props.count ? props.count(group()) : total(group())}</span>
            </TreeView.BranchControl>
            {props.mark?.(group())}

          </div>
          {props.detail?.(group())}
          <TreeView.BranchContent>{props.children(group)}{branches(() => group().children ?? [], indexPath, () => group().items.length ? 1 : 0)}</TreeView.BranchContent>
        </TreeView.Branch>
      </TreeView.NodeProvider>; }}</For>
  );

  return <TreeView.Root collection={collection()} expandedValue={collection().getBranchValues().filter(id => !closed().includes(id))} selectedValue={[]} expandOnClick
    onExpandedChange={details => {
      const branches = collection().getBranchValues();

      setClosed(kept => [...kept.filter(id => !branches.includes(id)), ...branches.filter(id => !details.expandedValue.includes(id))]);
    }}>
    <TreeView.Tree class="shelf-groups" aria-label={copy.shelfLabel}>
      {branches(shown, () => [])}
    </TreeView.Tree>
  </TreeView.Root>;
};
