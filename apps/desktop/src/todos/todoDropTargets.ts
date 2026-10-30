import type { ConnectedProject } from "../state/connectedProject";
import type { TodosState } from "./state";
import { ownersOnRail, sameOwner } from "../shelf/scope";

/** Existing Shelf drag destinations: a Rail Home or a different owner group. */
export const todoDropTargets = (connected: ConnectedProject, todos: TodosState) => ({
  home: (id: number, x: number, y: number) => {
    const current = todos.byId().get(id)?.home;
    const rail = document.querySelector(".rail");
    const clip = rail?.getBoundingClientRect();

    if (!clip || x < clip.left || x >= clip.right || y < clip.top || y >= clip.bottom) return null;

    for (const element of rail!.querySelectorAll<HTMLElement>(".rail-row[data-id], [data-todo-root]")) {
      const box = element.getBoundingClientRect();

      if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) continue;
      const home = element.hasAttribute("data-todo-root") ? null : element.dataset.id!;

      if (home === current || (home !== null && !connected.rail.nodes.some((node) => node.id === home && node.kind === "workstream"))) return null;

      return { element, home };
    }

    return null;
  },
  owner: (id: number, x: number, y: number) => {
    const own = todos.byId().get(id);

    for (const element of document.querySelectorAll<HTMLElement>(".todos-tab [data-shelf-group]")) {
      const box = element.getBoundingClientRect();

      if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) continue;
      const group = element.dataset.shelfGroup!;
      const owner = ownersOnRail(connected).find(each => each.id === group);

      // A drop on the own group reorders (U155), and a group that left the Rail takes nothing.
      if (!owner || !own || sameOwner(owner.actor, own.owner)) return null;

      return { element, attribute: "data-drop-target", owner: owner.actor };
    }

    return null;
  },
});
