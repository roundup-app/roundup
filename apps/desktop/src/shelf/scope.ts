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
    label: () => {
      const scope = selected();

      return scope.kind === "overview" ? copy.overview : scope.name;
    },
    home: () => {
      const scope = selected();

      return scope.kind === "overview" ? null : resolvedWorkstream(connected.rail.nodes, scope.id);
    },
    /** U3734: an Agent's view holds what it made and, given `owner`, what it owns. */
    includes: (home: string | null, maker: Actor, owner?: Actor | null) => {
      const scope = selected();
      const is = (actor: Actor | null | undefined) => scope.kind === "agent" && actor?.kind === "agent" && actor.id === scope.id;

      return scope.kind === "overview" || (scope.kind === "workstream" ? home === scope.id : is(maker) || is(owner));
    },
    /** U3733, U3735: the Actor of the Agent selected in the Rail, else null. */
    agent: (): Actor | null => {
      const scope = selected();

      return scope.kind === "agent" ? { kind: "agent", id: scope.id, parent: null } : null;
    },
  };
};

/** U3717: who can own a Todo, in the order the Shelf groups them: Me, each Agent on the Rail in Rail order, Unassigned (`actor` null). */
export type Owner = { id: string; name: string; actor: Actor | null };

const USER_OWNER: Actor = { kind: "user", id: "you", parent: null };

export const ownersOnRail = (connected: ConnectedProject): Owner[] => {
  const nodes = connected.rail.nodes;
  const agents = siblingsOf(nodes, null).flatMap(node => [node, ...descendantsOf(nodes, node.id)]).filter(node => node.kind === "agent");

  return [
    { id: "me", name: copy.me, actor: USER_OWNER },
    ...agents.map(node => ({ id: node.id, name: node.name, actor: { kind: "agent", id: node.id, parent: null } satisfies Actor })),
    { id: "unassigned", name: copy.unassigned, actor: null },
  ];
};

export const sameOwner = (a: Actor | null, b: Actor | null) => a === null || b === null ? a === b : a.kind === b.kind && a.id === b.id;

export type OwnerGroup<T> = Owner & { items: T[] };

/** U3717: every owner of the Rail with the items it owns once each; an owner that left the Rail reads as Unassigned. Empty groups are kept: the caller decides when they show. */
export const ownerGroups = <T,>(connected: ConnectedProject, items: readonly T[], ownerOf: (item: T) => Actor | null): OwnerGroup<T>[] => {
  const empty = (): T[] => [];
  const groups = ownersOnRail(connected).map(owner => ({ ...owner, items: empty() }));
  const unassigned = groups[groups.length - 1]!;

  for (const item of items) (groups.find(group => group.actor !== null && sameOwner(group.actor, ownerOf(item))) ?? unassigned).items.push(item);

  return groups;
};
