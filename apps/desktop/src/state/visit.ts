import { createSignal } from "solid-js";
import * as v from "valibot";
import type { Event } from "@contracts/Event";
import type { Events } from "../app/events";
import { storageSchema, storedValue } from "./storage";

const schema = storageSchema("roundup:last-visit", v.object({ seq: v.number(), at: v.number() }));

export type Visit = { seq: number; at: number };

/** U504: the last retained visit per original Project. Two Projects never share a boundary. */
export const visitStorage = (path: string) => storedValue(`roundup:last-visit:${path}`, schema);

/**
 * U504: saved Events the change list reads, and the Event number reached. Replay and live Events arrive
 * through one ordered subscription (D11), so `head` is the highest number the App has processed.
 */
export const createVisits = (events: Events, storage: ReturnType<typeof visitStorage>) => {
  const [saved, setSaved] = createSignal<Event[]>([]);
  const [head, setHead] = createSignal(0);

  events.subscribe(event => {
    if (event.seq !== undefined && event.seq > head()) setHead(event.seq);

    if (event.name === "agent.completed" || event.name === "deliverable.published") setSaved(all => [...all, event]);
  }, { replay: true });

  return {
    saved,
    head,
    /** The previous successfully retained visit, or null on a first visit. */
    previous: (): Visit | null => storage.read() ?? null,
    /** Retain the Event number a rendered list covered; resolves to the failure cause, or null. */
    retain: (visit: Visit): Promise<string | null> => storage.write(visit),
  };
};

export type Visits = ReturnType<typeof createVisits>;
