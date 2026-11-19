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

/** U7499a, U7499b: the Pads above the folds and the two folds of one Home group, in the group's order. The open Pad stays above the folds, except one opened from an open fold, which keeps its row there until the Drawer leaves it. */
export const foldPads = (pads: readonly Pad[], read: PadRead, now: number, open: string | null, isFoldOpen: (fold: "internal" | "idle") => boolean = () => false): FoldedPads => {
  const folded: FoldedPads = { above: [], internal: [], idle: [] };

  for (const pad of pads) {
    const mark = read.mark(pad);

    const fold = pad.visibility === "internal" ? "internal" : mark === null || now - pad.updated_at >= IDLE_AFTER_MS ? "idle" : null;

    if (fold === null || (pad.name === open && !isFoldOpen(fold))) folded.above.push({ pad, mark });
    else folded[fold].push(pad);
  }

  return folded;
};

/** U7499a: both folds of every group start closed; a key is `<group id>:<fold>`. `walked` is the Pads a key walk visits: those above the folds and in an open fold. */
export const createFolds = (groups: () => readonly { id: string; items: readonly Pad[] }[], now: () => number, list?: PadList) => {
  const read = usePadRead(list);
  const [unfolded, setUnfolded] = createSignal<readonly string[]>([]);
  const toggleFold = (key: string) => setUnfolded(open => open.includes(key) ? open.filter(each => each !== key) : [...open, key]);

  const folded = createMemo(() => new Map(groups().map(group => [group.id, foldPads(group.items, read, now(), read.open(), fold => unfolded().includes(`${group.id}:${fold}`))] as const)));

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
