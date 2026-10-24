import { createEffect, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import * as v from "valibot";
import type { RailNode } from "@contracts/agent/RailNode";
import { descendantsOf } from "../rail/layout";
import { storedValue } from "./storage";

/** U3566c: the finish count the user has read, per Agent id, of one original Project. */
const acknowledgedSchema = v.record(v.string(), v.pipe(v.string(), v.regex(/^\d+$/)));

type Acknowledged = v.InferOutput<typeof acknowledgedSchema>;

export const unseenStorage = (path: string) => storedValue(`roundup:unseen:${path}`, acknowledgedSchema);

export type UnseenStorage = ReturnType<typeof unseenStorage>;

export type UnseenState = {
  /** U3566a: whether Agent `id` finished a turn the user has not viewed. */
  of(id: string): boolean;
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
): UnseenState => {
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

  const of = (id: string): boolean => {
    const node = nodes().find((each) => each.id === id);

    return baselined() && node !== undefined && finishes(node) > BigInt(read()[id] ?? "0");
  };

  return {
    of,
    below: (id) => descendantsOf(nodes(), id).some((node) => of(node.id)),
    any: () => nodes().some((node) => of(node.id)),
  };
};
