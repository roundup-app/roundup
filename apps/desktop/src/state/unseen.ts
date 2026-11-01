import { createEffect, createSignal, createResource, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import * as v from "valibot";
import type { AppSeam } from "../app/seam";
import type { Events } from "../app/events";
import type { Deliverable } from "@contracts/deliverable/Deliverable";
import type { RailNode } from "@contracts/agent/RailNode";
import { descendantsOf } from "../rail/layout";
import { storageSchema, storedValue } from "./storage";

/** U3566c: the finish count the user has read, per Agent id, of one original Project. */
const acknowledgedSchema = storageSchema("roundup:unseen", v.record(v.string(), v.pipe(v.string(), v.regex(/^\d+$/))));

type Acknowledged = v.InferOutput<typeof acknowledgedSchema>;

export const unseenStorage = (path: string) => storedValue(`roundup:unseen:${path}`, acknowledgedSchema);

export type UnseenStorage = ReturnType<typeof unseenStorage>;

const finishTimesSchema = storageSchema("roundup:finish-times", v.record(v.string(), v.object({ count: v.string(), at: v.number() })));

const publicationsSchema = storageSchema("roundup:seen-publications", v.record(v.string(), v.boolean()));

export type UnseenState = {
  /** U3566a: whether Agent `id` finished a turn the user has not viewed. */
  of(id: string): boolean;
  /** U5502: latest unread deliberately committed publication, from this Project's list. */
  finishAt(id: string): number;
  publicationAt(id: string): number | null;
  publicationFailure(): string | null;
  /** U3566b: whether any Agent below Workstream `id` is unseen. */
  below(id: string): boolean;
  /** U3566b: whether any Agent of the Project is unseen. */
  any(): boolean;
};

const finishes = (node: RailNode): bigint => BigInt(node.status?.finished ?? "0");

/**
 * U3566: an Agent is unseen while its Daemon-kept finish count is above the count the user has
 * read. The read counts are App state per original Project, so they survive a reload; with no
 * record yet, the first tree's counts are the baseline and history is not unread. `viewing`
 * holds while the selected Agent's pane is displayed in a visible, focused, active Project.
 */
export const createUnseen = (
  nodes: () => readonly RailNode[],
  selected: Accessor<string | null>,
  viewing: Accessor<boolean>,
  storage: Pick<UnseenStorage, "read" | "write"> = unseenStorage(""),
  publications?: { app: AppSeam; events: Events; path: string },
): UnseenState => {
  const finishStorage = storedValue(`roundup:finish-times:${publications?.path ?? ""}`, finishTimesSchema);
  const [finishTimes, setFinishTimes] = createSignal(finishStorage.read() ?? {});

  createEffect(() => {
    const next = { ...finishTimes() };
    let changed = false;

    for (const node of nodes()) {
      if (node.status && next[node.id]?.count !== node.status.finished) {
        next[node.id] = { count: node.status.finished, at: node.status.since };
        changed = true;
      }
    }

    if (changed) {
      setFinishTimes(next);
      finishStorage.write(next);
    }
  });

  const saved = storage.read();
  const [read, setRead] = createSignal<Acknowledged>(saved ?? {});
  const [baselined, setBaselined] = createSignal(saved !== null);

  const acknowledge = (changes: Acknowledged) => {
    const next = { ...read(), ...changes };

    setRead(next);
    storage.write(next);
  };

  createEffect(() => {
    const tree = nodes();

    if (baselined() || tree.length === 0) return;

    setBaselined(true);
    acknowledge(Object.fromEntries(tree.map((node) => [node.id, finishes(node).toString()])));
  });

  createEffect(() => {
    const node = viewing() ? nodes().find((each) => each.id === selected()) : undefined;

    if (!node || !baselined()) return;

    const count = finishes(node).toString();

    if (BigInt(read()[node.id] ?? "0") < finishes(node)) acknowledge({ [node.id]: count });
  });

  const publicationStorage = storedValue(`roundup:seen-publications:${publications?.path ?? ""}`, publicationsSchema);
  const retained = publicationStorage.read();
  const [seenPublications, setSeenPublications] = createSignal(retained);
  const [publicationFailure, setPublicationFailure] = createSignal<string | null>(null);

  const [catalogue, { refetch }] = createResource(async (_key, { value }): Promise<Deliverable[]> => {
    if (!publications) return [];

    try {
      const records = await publications.app.rpc("deliverable.list", { home: null, maker: null });
      const previous = seenPublications();
      const next = { ...previous };

      for (const record of records) {
        if (!(record.id in next)) next[record.id] = previous === null;
      }

      setSeenPublications(next);
      publicationStorage.write(next);
      setPublicationFailure(null);

      return records;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setPublicationFailure(error.message);

      return value ?? [];
    }
  });

  if (publications) {
    const stop = publications.events.subscribe(event => {
      if (event.name === "deliverable.changed") void refetch();
    });

    onCleanup(stop);
  }

  createEffect(() => {
    if (!viewing() || selected() === null) return;

    const next = { ...seenPublications() };
    let changed = false;

    for (const record of catalogue() ?? []) {
      if (record.maker.kind === "agent" && record.maker.id === selected() && next[record.id] === false) {
        next[record.id] = true;
        changed = true;
      }
    }

    if (changed) {
      setSeenPublications(next);
      publicationStorage.write(next);
    }
  });

  const of = (id: string): boolean => {
    const node = nodes().find((each) => each.id === id);

    return baselined() && node !== undefined && finishes(node) > BigInt(read()[id] ?? "0");
  };

  return {
    of,
    finishAt: id => finishTimes()[id]?.at ?? 0,
    publicationAt: id => {
      const times = (catalogue() ?? []).filter(record => record.maker.kind === "agent" && record.maker.id === id && seenPublications()?.[record.id] === false).map(record => record.published_at);

      return times.length ? Math.max(...times) : null;
    },
    publicationFailure,
    below: (id) => descendantsOf(nodes(), id).some((node) => of(node.id)),
    any: () => nodes().some((node) => of(node.id)),
  };
};
