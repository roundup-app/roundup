import { createMemo, createSignal } from "solid-js";
import type { Pad } from "@contracts/pad/Pad";
import { usePadRead, type PadMark, type PadRead } from "./padRead";
import type { PadList } from "./padList";

/** U7499a: a `shown` Pad no one has written for this long is idle. */
const IDLE_AFTER_MS = 7 * 86_400_000;

export type FoldedPads = {
  /** In the group's order, each with the dot it carries. */
  above: { pad: Pad; mark: PadMark }[];
  internal: Pad[];
  idle: Pad[];
};

/** U7499a, U7499b: the Pads above the folds and the two folds of one Home group, in the group's order. The open Pad stays where it sat when it opened (`pin`): in an open fold, or above the folds, until the Drawer leaves it. */
export const foldPads = (pads: readonly Pad[], read: PadRead, now: number, open: string | null, pin: "above" | "internal" | "idle" = "above"): FoldedPads => {
  const folded: FoldedPads = { above: [], internal: [], idle: [] };

  for (const pad of pads) {
    const mark = read.mark(pad);

    const fold = pad.visibility === "internal" ? "internal" : mark === null || now - pad.updated_at >= IDLE_AFTER_MS ? "idle" : null;

    const where = pad.name === open ? pin : fold === null ? "above" : fold;

    if (where === "above") folded.above.push({ pad, mark });
    else folded[where].push(pad);
  }

  return folded;
};

/** U7499a: both folds of every group start closed; a key is `<group id>:<fold>`. `walked` is the Pads a key walk visits: those above the folds and in an open fold. */
export const createFolds = (groups: () => readonly { id: string; items: readonly Pad[] }[], now: () => number, list?: PadList) => {
  const read = usePadRead(list);
  const [unfolded, setUnfolded] = createSignal<readonly string[]>([]);
  const toggleFold = (key: string) => setUnfolded(open => open.includes(key) ? open.filter(each => each !== key) : [...open, key]);

  // Where each Pad sat on the last run while closed, and the place the open Pad was pinned to when it opened.
  let sat = new Map<string, "above" | "internal" | "idle">();
  let pinned: { name: string; where: "above" | "internal" | "idle" } | null = null;

  const folded = createMemo(() => {
    const open = read.open();

    if (open === null) pinned = null;
    else if (pinned?.name !== open) pinned = { name: open, where: sat.get(open) ?? "above" };

    const next = new Map<string, "above" | "internal" | "idle">();

    const result = new Map(groups().map(group => {
      const fold = foldPads(group.items, read, now(), open, pinned?.where);
      const seen = (kind: "internal" | "idle", pads: readonly Pad[]) => pads.forEach(pad => next.set(pad.name, unfolded().includes(`${group.id}:${kind}`) ? kind : "above"));

      seen("internal", fold.internal);
      seen("idle", fold.idle);

      return [group.id, fold] as const;
    }));

    sat = next;

    return result;
  });

  const walked = createMemo(() => groups().flatMap(group => {
    const fold = folded().get(group.id);

    if (!fold) return [];

    return [
      ...fold.above.map(each => each.pad),
      ...(unfolded().includes(`${group.id}:internal`) ? fold.internal : []),
      ...(unfolded().includes(`${group.id}:idle`) ? fold.idle : []),
    ];
  }));

  /** The fold props one group's rows take. */
  const of = (group: () => { id: string }) => ({
    folded: () => folded().get(group().id) ?? { above: [], internal: [], idle: [] },
    isFoldOpen: (fold: "internal" | "idle") => unfolded().includes(`${group().id}:${fold}`),
    toggleFold: (fold: "internal" | "idle") => toggleFold(`${group().id}:${fold}`),
  });

  return { walked, of, read };
};
