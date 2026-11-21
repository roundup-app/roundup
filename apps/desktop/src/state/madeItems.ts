import { createSignal, onCleanup } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import type { MadeItem } from "@contracts/links/MadeItem";
import type { AppSeam } from "../app/seam";
import type { Events } from "../app/events";

/** LH20: each Agent's made list, read once on first sight and read again on each `agent.made` event; empty until it arrives. */
export const createMadeItems = (app: AppSeam, events: Events, daemonExit: Accessor<unknown>) => {
  type Cell = [Accessor<MadeItem[]>, Setter<MadeItem[]>];

  const cells = new Map<string, Cell>();
  const asked = new Set<string>();

  const cell = (id: string): Cell => {
    const found = cells.get(id);

    if (found) return found;
    const [get, set] = createSignal<MadeItem[]>([]);
    const made: Cell = [get, set];

    cells.set(id, made);

    return made;
  };

  // The header has no failure line: a failed read leaves the list as it was, and the next event reads again.
  const load = (id: string) => void app.rpc("agent.made", { id }).then(list => cell(id)[1](list), error => console.error(error));

  onCleanup(events.subscribe(event => {
    if (event.name === "agent.made") load(event.data.id);
  }));

  return {
    read: (id: string): MadeItem[] => {
      const [get] = cell(id);

      if (!asked.has(id) && !daemonExit()) {
        asked.add(id);
        load(id);
      }

      return get();
    },
    /** LH22: a gone item leaves the list stale, so it is read again. */
    refresh: load,
  };
};

export type MadeItems = ReturnType<typeof createMadeItems>;
