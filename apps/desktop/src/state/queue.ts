import { createEffect, createSignal, untrack } from "solid-js";
import type { QueueEntry } from "@contracts/workstream/QueueEntry";
import type { Events } from "../app/events";
import type { AppSeam } from "../app/seam";
import type { RailState } from "./rail";

/** U3744: the Workstreams waiting to start, in the Daemon's order. */
export type QueueView = {
  /** The entry of a Workstream with its place from 1 and the Queue's length, or `null` once its Door started or it left the Queue. */
  entryOf(workstream: string): { entry: QueueEntry; place: number; of: number } | null;
  refresh(): Promise<void>;
};

export const createQueue = (app: AppSeam, events: Events, rail: RailState): QueueView => {
  const [entries, setEntries] = createSignal<readonly QueueEntry[]>([]);

  const refresh = async () => {
    try {
      setEntries((await app.rpc("workstream.queue", null)).entries);
    } catch {
      // A Daemon without a Queue has none to show; the next Event asks again.
    }
  };

  events.subscribe(event => { if (event.name === "workstream.queueChanged") void refresh(); });

  // Only a Workstream whose Door never started can be queued, so no such row means nothing to ask.
  createEffect(() => {
    const waiting = rail.nodes.some(node => node.kind === "workstream" && node.attempt === null);

    untrack(() => { if (waiting) void refresh(); else setEntries([]); });
  });

  return {
    entryOf: workstream => {
      const place = entries().findIndex(entry => entry.workstream === workstream);

      return place < 0 ? null : { entry: entries()[place]!, place: place + 1, of: entries().length };
    },
    refresh,
  };
};
