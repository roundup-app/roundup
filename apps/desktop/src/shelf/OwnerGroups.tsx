import { createEffect, createMemo, createSignal, For, Show, untrack, type Accessor } from "solid-js";
import type { JSX } from "@solidjs/web";
import { TreeItem, TreeItemIndicator, type TreeItemData } from "@ui-sdk/solid/tree";
import { AppTree } from "../ui/TreeView";
import { Icon } from "../ink/Icon";
import { Tip } from "../ui/Tip";
import { copy } from "./copy";
import { captureFocus } from "../keys/focus";
import type { OwnerGroup } from "./scope";

/** The groups as the items the tree walks; the group named like the scope has no header to walk to, so its own groups stand in its place. */
const treeItems = <T,>(groups: readonly OwnerGroup<T>[], bare: string | null): TreeItemData[] => groups.flatMap(group => {
  const children = treeItems(group.children ?? [], bare);

  return group.id === bare ? children : [{ value: group.id, label: group.name, children }];
});

const sameItems = (a: readonly TreeItemData[], b: readonly TreeItemData[]): boolean => a.length === b.length && a.every((item, index) => {
  const other = b[index];

  return other !== undefined && item.value === other.value && item.label === other.label && sameItems(item.children ?? [], other.children ?? []);
});

const groupIds = <T,>(groups: readonly OwnerGroup<T>[]): string[] => groups.flatMap(group => [group.id, ...groupIds(group.children ?? [])]);

/** Nonempty owner groups use the existing tree so explicit folds survive item refetches. */
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
  const startsClosed = untrack(() => !props.unfold?.() && !props.arrivals?.().includes("unassigned") && props.focus?.() !== "unassigned" && props.groups().some(group => group.id === "unassigned" && group.items.length > 0) ? ["unassigned"] : []);

  const [closed, setClosed] = createSignal<string[]>((kept = startsClosed) => {
    const reveal = props.reveal();
    const arrivals = props.arrivals?.() ?? [];

    return kept.filter(each => each !== reveal && !arrivals.includes(each));
  });

  createEffect(closed, ids => { props.onClosedChange?.(ids); });

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
  const total = (group: OwnerGroup<T>): number => group.items.length + (group.children ?? []).reduce((sum, child) => sum + total(child), 0);

  const items = createMemo(() => treeItems(shown(), props.bare?.() ?? null), { equals: sameItems });

  const focusedGroup = createMemo(() => {
    const id = props.focus?.();

    return id !== null && id !== undefined && allGroups().some(group => group.id === id) ? id : undefined;
  });

  createEffect(focusedGroup, id => {
    if (id === undefined) return;
    setClosed(kept => kept.filter(each => each !== id && !shown().some(group => group.id === each && group.children?.some(child => child.id === id))));
    const focus = captureFocus();

    // The controlled open state shows the group before the next paint; a hidden Todo cannot take native focus.
    requestAnimationFrame(() => focus(() => {
      if (props.focus?.() !== id) return;
      const branch = document.querySelector<HTMLElement>(`[data-shelf-group="${CSS.escape(id)}"]`);
      const target = props.focusItem?.() ?? branch?.querySelector<HTMLElement>(".shelf-group-head .shelf-group-control") ?? branch?.querySelector<HTMLElement>("button");

      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
      props.onFocused?.();
    }));
  });

  const branches = (groups: Accessor<readonly OwnerGroup<T>[]>, level: number): JSX.Element => (
    <For each={groups().map(group => group.id)}>{id => {
      const group = () => groups().find(each => each.id === id)!;
      const open = () => !closed().includes(id);

      return <div data-shelf-group={id} data-level={level} data-drop-target={props.target?.() === id ? "" : undefined}>
        <Show when={props.bare?.() !== id}>
          <div class="shelf-group-head">
            <TreeItem value={id} class="shelf-group-control row-wash row-wash-inert" data-button="quiet">
              <TreeItemIndicator><Icon name={open() ? "down" : "right"} /></TreeItemIndicator>
              <Tip text={group().name}>{trigger => <span {...trigger()} class="shelf-group-name">{group().name}</span>}</Tip>
              <span class="shelf-group-count" data-state="">{props.count ? props.count(group()) : total(group())}</span>
            </TreeItem>
            {props.mark?.(group())}
          </div>
        </Show>
        {props.detail?.(group())}
        <div class="shelf-group-body" role="group" hidden={!open()} data-open={open() ? "" : undefined} data-closed={open() ? undefined : ""}>{props.children(group)}{branches(() => group().children ?? [], level + 1)}</div>
      </div>;
    }}</For>
  );

  return <AppTree<"none"> class="shelf-groups" aria-label={copy.shelfLabel} items={items()} mode="none"
    expanded={groupIds(shown()).filter(id => !closed().includes(id))}
    onExpandedChange={expanded => {
      const known = groupIds(shown());

      setClosed(kept => [...kept.filter(id => !known.includes(id)), ...known.filter(id => !expanded.includes(id))]);
    }}>
    {branches(shown, 1)}
  </AppTree>;
};
