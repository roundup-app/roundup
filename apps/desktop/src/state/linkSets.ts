import { createSignal, onCleanup } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import type { LinkSet } from "@contracts/links/LinkSet";
import type { AppSeam } from "../app/seam";
import type { Events } from "../app/events";

/** LH4: each Agent's last link set, read once on first sight and replaced by each `agent.links` event; none until it arrives. */
export const createLinkSets = (app: AppSeam, events: Events, daemonExit: Accessor<unknown>) => {
  type Cell = [Accessor<LinkSet | undefined>, Setter<LinkSet | undefined>];

  const cells = new Map<string, Cell>();
  const asked = new Set<string>();
  const heard = new Set<string>();

  const cell = (id: string): Cell => {
    const found = cells.get(id);

    if (found) return found;
    const [get, set] = createSignal<LinkSet | undefined>(undefined);
    const made: Cell = [get, set];

    cells.set(id, made);

    return made;
  };

  onCleanup(events.subscribe(event => {
    if (event.name !== "agent.links") return;
    heard.add(event.data.id);
    cell(event.data.id)[1](event.data.set);
  }));

  return {
    read: (id: string): LinkSet | undefined => {
      const [get] = cell(id);

      if (!asked.has(id) && !daemonExit()) {
        asked.add(id);

        // The header has no failure line: a failed read leaves the set empty, and the next event fills it.
        void app.rpc("agent.links", { id }).then(set => { if (!heard.has(id)) cell(id)[1](set); }, error => console.error(error));
      }

      return get();
    },
  };
};

export type LinkSets = ReturnType<typeof createLinkSets>;
