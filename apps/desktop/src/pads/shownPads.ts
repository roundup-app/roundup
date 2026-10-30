import type { Accessor } from "solid-js";
import type { Pad } from "@contracts/pad/Pad";
import type { PadList } from "../rail/pads/padList";
import type { ConnectedProject } from "../state/connectedProject";
import type { OwnerGroup } from "../shelf/scope";
import { railOrder } from "../rail/layout";

/** U2744a: the per-Project reader is the membership boundary, independent of Rail selection. */
export const shownPads = (_connected: ConnectedProject, list: PadList): Accessor<readonly Pad[]> => list.pads;

/** Pads are grouped only by their recorded Home. */
export const padGroups = (connected: ConnectedProject, pads: readonly Pad[]): OwnerGroup<Pad>[] => {
  const groups: OwnerGroup<Pad>[] = railOrder(connected.rail.nodes).filter(node => node.kind === "workstream").map(node => ({
    id: node.id, name: node.name, actor: null, items: [], children: [],
  }));

  const root: OwnerGroup<Pad> = { id: "unassigned", name: connected.project.name, actor: null, items: [] };
  groups.push(root);

  for (const pad of pads) (groups.find(group => group.id === pad.home) ?? root).items.push(pad);

  return groups;
};
