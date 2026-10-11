import { createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { Checkpoint } from "@contracts/checkpoint/Checkpoint";
import type { Events } from "../app/events";
import type { AppSeam } from "../app/seam";

/** U355: the Workstream's Checkpoints, newest first; a written event adds one without a reload, and one id keeps one entry. */
export const createCheckpointFeed = (app: AppSeam, events: Events, workstream: Accessor<string>): Accessor<readonly Checkpoint[]> => {
  const [byKey, setByKey] = createSignal<ReadonlyMap<string, Checkpoint>>(new Map());
  const keyOf = (checkpoint: Checkpoint) => `${checkpoint.workstream}:${checkpoint.id}`;

  const unsubscribe = events.subscribe((event) => {
    if (event.name === "checkpoint.written") setByKey((known) => new Map(known).set(keyOf(event.data), event.data));
  });

  onCleanup(unsubscribe);

  app.rpc("checkpoint.list", { workstream: workstream() }).then(
    (listed) => setByKey((known) => new Map([...listed.map((each) => [keyOf(each), each] as const), ...known])),
    (error) => {
      if (!(error instanceof Error)) throw error;
    },
  );

  return () => [...byKey().values()].filter((each) => each.workstream === workstream()).toSorted((a, b) => b.id - a.id);
};
