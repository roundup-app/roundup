import { createEffect, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { Checkpoint } from "@contracts/checkpoint/Checkpoint";
import type { Events } from "../app/events";
import type { AppSeam } from "../app/seam";

/** Checkpoints belong to the selected Door; late lists cannot cross Workstreams. */
export const createCheckpointFeed = (app: AppSeam, events: Events, workstream: Accessor<string>) => {
  const [checkpoints, setCheckpoints] = createSignal<Checkpoint[]>([]);
  const [failure, setFailure] = createSignal<string | null>(null);
  let generation = 0;

  const list = (id: string) => {
    const mine = ++generation;
    app.rpc("checkpoint.list", { workstream: id }).then(
      (cards) => {
        if (mine !== generation || id !== workstream()) return;

        setCheckpoints((known) => {
          const next = new Map(cards.map((card) => [card.id, card]));

          for (const card of known) next.set(card.id, card);

          return [...next.values()].sort((a, b) => a.id - b.id);
        });
        setFailure(null);
      },
      (error) => {
        if (!(error instanceof Error)) throw error;

        if (mine === generation && id === workstream()) setFailure(error.message);
      },
    );
  };

  createEffect(() => {
    const id = workstream();

    setCheckpoints([]);
    setFailure(null);
    list(id);
  });
  onCleanup(events.subscribe((event) => {
    if (event.name === "checkpoint.written" && event.data.workstream === workstream()) {
      setCheckpoints((cards) => [...cards.filter((c) => c.id !== event.data.id), event.data].sort((a,b) => a.id-b.id));
    }

    if (event.name === "workstream.rewound" && event.data.id === workstream()) {
      setCheckpoints((cards) => cards.map((c) => c.id > event.data.checkpoint ? { ...c, rewindable: false } : c));
      generation++;
    }
  }));
  onCleanup(() => { generation++; });

  return { checkpoints, failure };
};
