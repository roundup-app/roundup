import { createEffect, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { Checkpoint } from "@contracts/checkpoint/Checkpoint";
import type { Events } from "../app/events";
import type { AppSeam } from "../app/seam";

/** U355: the Workstream's Checkpoints, newest first; an event or a list keeps one entry per id, and a Workstream's events are its own. */
export const createCheckpointFeed = (app: AppSeam, events: Events, workstream: Accessor<string>): Accessor<readonly Checkpoint[]> => {
  const [byId, setById] = createSignal<ReadonlyMap<number, Checkpoint>>(new Map());

  const unsubscribe = events.subscribe((event) => {
    if (event.name !== "checkpoint.written" || event.data.workstream !== workstream()) return;

    const written = event.data;

    setById((known) => new Map(known).set(written.id, written));
  });

  onCleanup(unsubscribe);

  createEffect(() => {
    const mine = workstream();

    setById(new Map());
    app.rpc("checkpoint.list", { workstream: mine }).then(
      (listed) => {
        if (mine !== workstream()) return;

        setById((known) => {
          const next = new Map(known);

          // An event is newer than the list that raced it.
          for (const checkpoint of listed) if (!next.has(checkpoint.id)) next.set(checkpoint.id, checkpoint);

          return next;
        });
      },
      (error) => {
        if (!(error instanceof Error)) throw error;
      },
    );
  });

  return () => [...byId().values()].toSorted((a, b) => b.id - a.id);
};
