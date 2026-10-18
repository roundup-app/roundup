import { createMemo } from "solid-js";
import type { Actor } from "@contracts/Actor";
import type { ConnectedProject } from "../state/connectedProject";
import { descendantsOf, siblingsOf, resolvedWorkstream } from "../rail/layout";
import { copy } from "../copy";

type Scope = { kind: "overview" } | { kind: "workstream" | "agent"; id: string; name: string };

/** U2744a: selection is the only source of Shelf scope; no choice survives it. */
export const shelfScope = (connected: ConnectedProject) => {
  const selected = createMemo<Scope>(() => {
    const node = connected.rail.nodes.find(node => node.id === connected.rail.selected());

    return node ? { kind: node.kind, id: node.id, name: node.name } : { kind: "overview" };
  });

  return {
    selected,
    label: () => { const scope = selected();

 return scope.kind === "overview" ? copy.overview : scope.name; },
    home: () => { const scope = selected();

 return scope.kind === "overview" ? null : resolvedWorkstream(connected.rail.nodes, scope.id); },
    includes: (home: string | null, maker: Actor) => {
      const scope = selected();

      return scope.kind === "overview" || (scope.kind === "workstream" ? home === scope.id : maker.kind === "agent" && maker.id === scope.id);
    },
  };
};

export type ShelfGroup<T> = { id: string; name: string; items: T[]; children: ShelfGroup<T>[] };

/** U2744a: Home wins over maker; Rail order is read without its folded presentation. */
export const shelfGroups = <T,>(connected: ConnectedProject, items: readonly T[], homeOf: (item: T) => string | null, makerOf: (item: T) => Actor): ShelfGroup<T>[] => {
  const nodes = connected.rail.nodes;
  const selected = nodes.find(node => node.id === connected.rail.selected());

  if (selected?.kind === "agent") return [{ id: "flat", name: "", items: [...items], children: [] }];
  const ordered = siblingsOf(nodes, null).flatMap(node => [node, ...descendantsOf(nodes, node.id)]);
  const groups = new Map<string, ShelfGroup<T>>();

  const make = (id: string, name: string) => {
    const group: ShelfGroup<T> = { id, name, items: [], children: [] };
    groups.set(id, group);

    return group;
  };

  const roots: ShelfGroup<T>[] = [];

  for (const node of ordered) {
    if (node.kind === "workstream") roots.push(make(node.id, node.name));
    else {
      const group = make(node.id, node.name);
      const home = resolvedWorkstream(nodes, node.id);
      const parent = home === null ? undefined : groups.get(home);

      if (parent) parent.children.push(group);
      else roots.push(group);
    }
  }

  const unassigned = make("unassigned", copy.unassigned);
  roots.push(unassigned);

  for (const item of items) {
    const home = homeOf(item);
    const maker = makerOf(item);
    const agent = maker.kind === "agent" ? nodes.find(node => node.id === maker.id) : undefined;
    let group = home === null ? undefined : groups.get(home);

    if (agent && (home === null || (agent.kind === "agent" && resolvedWorkstream(nodes, agent.id) === home))) group = groups.get(agent.id);
    (group ?? unassigned).items.push(item);
  }

  const prune = (group: ShelfGroup<T>): ShelfGroup<T>[] => {
    group.children = group.children.flatMap(prune);

    return group.items.length || group.children.length ? [group] : [];
  };

  return (selected?.kind === "workstream" ? roots.filter(group => group.id === selected.id) : roots).flatMap(prune);
};
