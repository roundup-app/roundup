import type { Accessor } from "solid-js";
import type { Pad } from "@contracts/pad/Pad";
import type { PadList } from "../rail/pads/padList";
import type { ConnectedProject } from "../state/connectedProject";
import type { OwnerGroup } from "../shelf/scope";
import { railOrder, resolvedWorkstream } from "../rail/layout";
import { copy } from "../copy";

/** U2744a: the per-Project reader is the membership boundary, independent of Rail selection. */
export const shownPads = (_connected: ConnectedProject, list: PadList): Accessor<readonly Pad[]> => list.pads;

/** U2744a: Home wins placement; current Agent owners get a subgroup within that Home. */
export const padGroups = (connected: ConnectedProject, pads: readonly Pad[]): OwnerGroup<Pad>[] => {
  const nodes = railOrder(connected.rail.nodes);

  const groups: OwnerGroup<Pad>[] = nodes.flatMap(node => node.kind === "workstream" || resolvedWorkstream(nodes, node.id) === null ? [{
    id: node.id, name: node.name, actor: node.kind === "agent" ? { kind: "agent" as const, id: node.id, parent: null } : null,
    items: [], children: [],
  }] : []);

  const unassigned: OwnerGroup<Pad> = { id: "unassigned", name: copy.unassigned, actor: null, items: [] };
  groups.push(unassigned);

  for (const pad of pads) {
    const owner = nodes.find(node => node.kind === "agent" && pad.owner.kind === "agent" && node.id === pad.owner.id);
    const home = nodes.find(node => node.kind === "workstream" && node.id === pad.home);
    const workstream = home?.id ?? (owner ? resolvedWorkstream(nodes, owner.id) : null);
    const parent = groups.find(group => group.id === workstream);

    if (parent && owner) {
      const id = `${parent.id}:${owner.id}`;
      let group = parent.children!.find(group => group.id === id);

      if (!group) {
        group = { id, name: owner.name, actor: pad.owner, items: [] };
        parent.children!.push(group);
      }

      group.items.push(pad);
    } else (parent ?? groups.find(group => group.id === owner?.id) ?? unassigned).items.push(pad);
  }

  for (const group of groups) group.children?.sort((a, b) => nodes.findIndex(node => node.id === a.actor?.id) - nodes.findIndex(node => node.id === b.actor?.id));

  return groups;
};
