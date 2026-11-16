import { isDoor } from "./doorNode";
import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import * as v from "valibot";
import type { AppSeam } from "../app/seam";
import type { Events } from "../app/events";
import type { Deliverable } from "@contracts/deliverable/Deliverable";
import type { Status } from "@contracts/Status";
import type { RailNode } from "@contracts/agent/RailNode";
import { descendantsOf, isWorkstreamChild } from "./railTopology";
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
  /** Project catalogue shared by unread-result tracking and Made. */
  publications: {
    records: Accessor<Deliverable[]>;
    failure: Accessor<string | null>;
    loading: Accessor<boolean>;
    /** Read the catalogue again, for the Retry of its failure line. */
    reload: () => void;
  };
  /** U3566b: whether any Agent below Workstream `id` is unseen. */
  below(id: string): boolean;
  /** U3566b: whether any Agent of the Project is unseen. */
  any(): boolean;
};

const finishes = (node: RailNode): bigint => BigInt(isDoor(node) ? node.status?.finished ?? "0" : "0");

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
  publications?: { app: AppSeam; events: Events; path: string; observedAt: number },
): UnseenState => {
  const finishStorage = storedValue(`roundup:finish-times:${publications?.path ?? ""}`, finishTimesSchema);
  // The replay below runs inside this owner and retains finishes at once.
  const [finishTimes, setFinishTimes] = createSignal(finishStorage.read() ?? {}, { ownedWrite: true });

  const retainFinish = (id: string, status: Pick<Status, "kind" | "finished" | "since">) => {
    // A working Status dates the new work, never the earlier finish.
    if (status.kind !== "idle" && status.kind !== "done" && status.kind !== "blocked") return;
    // SAFETY: the updater below assigns it; flow analysis does not follow an assignment made inside a callback.
    let next = undefined as ReturnType<typeof finishTimes> | undefined;

    // Several Agents finish in one tree: each retention starts from the one before it.
    setFinishTimes(all => BigInt(status.finished) <= BigInt(all[id]?.count ?? "0") ? all : next = { ...all, [id]: { count: status.finished, at: status.since } });

    if (next) finishStorage.write(next);
  };

  if (publications) {
    // Recover counted finishes from a disconnected gap before reconciling the current tree.
    const stop = publications.events.subscribe(event => {
      if (event.name !== "agent.status") return;
      const node = nodes().find(node => node.id === event.data.id);

      // The current Rail already applied its Attempt/revision guards. Stale events may
      // describe history, but cannot introduce a finish the authoritative tree lacks.
      if (node && BigInt(event.data.status.finished) <= finishes(node)) retainFinish(node.id, event.data.status);
    }, { replay: true });

    onCleanup(stop);
  }

  createEffect(() => nodes().flatMap(node => isDoor(node) && node.status ? [{ id: node.id, kind: node.status.kind, finished: node.status.finished, since: node.status.since }] : []), retained => {
    for (const { id, ...status } of retained) retainFinish(id, status);
  });

  const saved = storage.read();
  const [read, setRead] = createSignal<Acknowledged>(saved ?? {});
  const [baselined, setBaselined] = createSignal(saved !== null);

  const acknowledge = (changes: Acknowledged) => {
    let next!: Acknowledged;

    setRead(all => next = { ...all, ...changes });
    storage.write(next);
  };

  createEffect(() => {
    const tree = nodes();

    if (baselined() || tree.length === 0) return undefined;

    return Object.fromEntries(tree.map((node) => [node.id, finishes(node).toString()]));
  }, counts => {
    if (!counts) return;

    setBaselined(true);
    acknowledge(counts);
  });

  createEffect(() => {
    const node = viewing() ? nodes().find((each) => each.id === selected()) : undefined;

    if (!node || !baselined()) return undefined;

    return BigInt(read()[node.id] ?? "0") < finishes(node) ? { [node.id]: finishes(node).toString() } : undefined;
  }, changes => {
    if (changes) acknowledge(changes);
  });

  const publicationStorage = storedValue(`roundup:seen-publications:${publications?.path ?? ""}`, publicationsSchema);
  const retained = publicationStorage.read();
  const [seenPublications, setSeenPublications] = createSignal(retained);
  const [publicationFailure, setPublicationFailure] = createSignal<string | null>(null);

  const [catalogue, setCatalogue] = createSignal<Deliverable[]>();
  const [loading, setLoading] = createSignal(true);
  let requested = 0;

  const list = async (): Promise<Deliverable[] | null> => {
    if (!publications) return [];

    try {
      const records = await publications.app.rpc("deliverable.list", { home: null, maker: null });
      const previous = seenPublications();
      const next = { ...previous };

      for (const record of records) {
        // A failed initial read cannot acknowledge publications made during recovery.
        if (!(record.id in next)) next[record.id] = previous === null && (publicationFailure() === null || record.published_at < publications.observedAt);
      }

      setSeenPublications(next);
      publicationStorage.write(next);
      setPublicationFailure(null);

      return records;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setPublicationFailure(error.message);

      return null;
    }
  };

  // The catalogue keeps its last list through a failed or later read; only the newest read lands.
  const load = async () => {
    const mine = ++requested;
    const records = await list();

    if (mine !== requested) return;

    setCatalogue(previous => records ?? previous ?? []);
    setLoading(false);
  };

  const reload = () => {
    setLoading(true);
    void load();
  };

  void untrack(load);

  if (publications) {
    const stop = publications.events.subscribe(event => {
      if (event.name === "deliverable.changed") reload();
    });

    onCleanup(stop);
  }

  createEffect(() => {
    if (!viewing() || selected() === null) return undefined;

    const next = { ...seenPublications() };
    let changed = false;

    for (const record of catalogue() ?? []) {
      if (record.maker.kind === "agent" && record.maker.id === selected() && next[record.id] === false) {
        next[record.id] = true;
        changed = true;
      }
    }

    return changed ? next : undefined;
  }, next => {
    if (!next) return;

    setSeenPublications(next);
    publicationStorage.write(next);
  });

  const of = (id: string): boolean => {
    const node = nodes().find((each) => each.id === id);

    return baselined() && node !== undefined && !isWorkstreamChild(nodes(), node) && finishes(node) > BigInt(read()[id] ?? "0");
  };

  return {
    of,
    finishAt: id => finishTimes()[id]?.at ?? 0,
    publicationAt: id => {
      const node = nodes().find(each => each.id === id);

      if (node && isWorkstreamChild(nodes(), node)) return null;

      const times = (catalogue() ?? []).filter(record => record.maker.kind === "agent" && record.maker.id === id && seenPublications()?.[record.id] === false).map(record => record.published_at);

      return times.length ? Math.max(...times) : null;
    },
    publicationFailure,
    publications: {
      records: () => catalogue() ?? [],
      failure: publicationFailure,
      loading,
      reload,
    },
    below: (id) => descendantsOf(nodes(), id).some((node) => of(node.id)),
    any: () => nodes().some((node) => of(node.id)),
  };
};
