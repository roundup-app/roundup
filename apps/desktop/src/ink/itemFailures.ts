import { createMemo, type Accessor, createStore } from "solid-js";

type Entry<Cause> = { cause: Cause; stint: number | undefined };

type Stints<K> = { stints: ReadonlyMap<K, number>; next: number };

/**
 * P3557c: a failure that belongs to an item. It shows only while its key is present, and a key that
 * left and came back starts clean. `"unknown"` (a fault) keeps every failure as it stands.
 */
export const createItemFailures = <K, Cause = string>(present: Accessor<readonly K[] | "unknown">) => {
  const [record, setRecord] = createStore<Record<string, Entry<Cause> | undefined>>({});

  // Each stretch a key is present has its own number, so a failure set in an earlier stretch never shows again.
  const stretches = createMemo<Stints<K>>((previous = { stints: new Map(), next: 0 }) => {
    const keys = present();

    if (keys === "unknown") return previous;
    let next = previous.next;
    const stints = new Map<K, number>();

    for (const key of keys) stints.set(key, previous.stints.get(key) ?? next++);

    return { stints, next };
  });

  const failure = (key: K): Cause | undefined => {
    const entry = record[String(key)];

    if (entry === undefined) return undefined;
    const keys = present();
    const stint = stretches().stints.get(key);

    if (keys === "unknown") return stint === entry.stint || entry.stint === undefined ? entry.cause : undefined;

    return stint !== undefined && (entry.stint === undefined || entry.stint === stint) ? entry.cause : undefined;
  };

  const fail = (key: K, cause: Cause): void => {
    const stint = stretches().stints.get(key);

    setRecord(draft => { draft[String(key)] = { cause, stint }; });
  };

  const clear = (key: K): void => {
    setRecord(draft => { delete draft[String(key)]; });
  };

  return { failure, fail, clear };
};
