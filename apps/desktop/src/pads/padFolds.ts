import { createMemo, createSignal } from "solid-js";
import type { Pad } from "@contracts/pad/Pad";
import { usePadRead, type PadMark, type PadRead } from "./padRead";

/** U7499a: a `shown` Pad no one has written for this long is idle. */
const IDLE_AFTER_MS = 7 * 86_400_000;

export type FoldedPads = {
  /** In the group's order, each with the dot it carries. */
  above: { pad: Pad; mark: PadMark }[];
  internal: Pad[];
  idle: Pad[];
};

/** U7499a, U7499b: the Pads above the folds and the two folds of one Home group, in the group's order. The open Pad stays above the folds. */
export const foldPads = (pads: readonly Pad[], read: PadRead, now: number, open: string | null): FoldedPads => {
  const folded: FoldedPads = { above: [], internal: [], idle: [] };

  for (const pad of pads) {
    const mark = read.mark(pad);

    if (pad.name === open) folded.above.push({ pad, mark });
    else if (pad.visibility === "internal") folded.internal.push(pad);
    else if (mark === null || now - pad.updated_at >= IDLE_AFTER_MS) folded.idle.push(pad);
    else folded.above.push({ pad, mark });
  }

  return folded;
};

/** U7499a: both folds of every group start closed; a key is `<group id>:<fold>`. `walked` is the Pads a key walk visits: those above the folds and in an open fold. */
export const createFolds = (groups: () => readonly { id: string; items: readonly Pad[] }[], now: () => number) => {
  const read = usePadRead();
  const [unfolded, setUnfolded] = createSignal<readonly string[]>([]);
  const toggleFold = (key: string) => setUnfolded(open => open.includes(key) ? open.filter(each => each !== key) : [...open, key]);

  const folded = createMemo(() => new Map(groups().map(group => [group.id, foldPads(group.items, read, now(), read.open())] as const)));

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
