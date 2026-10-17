import { createEffect, on } from "solid-js";
import type { Accessor } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import type { Sortable } from "../ui";
import type { SortedRow } from "./Todos";
import { beforeOf, REORDER_EASING, REORDER_MS } from "./beforeOf";

/** The vertical offset a computed `transform` holds, 0 for none: where a running slide has the row on screen. */
const offsetOf = (el: Element): number => {
  const match = /matrix\(([^)]+)\)/.exec(getComputedStyle(el).transform);

  return match ? Number(match[1]!.split(",")[5]) || 0 : 0;
};

type Parts = Parameters<Parameters<typeof Sortable.Item>[0]["children"]>[0];

/** U490a, U156: the rows of one list ordered through `ui/Sortable`: one `todo.reorder` per move, rows that change place slide, and the moved row keeps focus. */
export const createSortedRows = (source: {
  /** The ids of the list's rows, top to bottom. */
  ids: Accessor<readonly number[]>;
  /** Every Todo, in the Daemon's order. */
  all: Accessor<readonly Todo[]>;
  call: (params: { id: number; before: number | null }) => Promise<string | null>;
  reducedMotion: Accessor<boolean>;
}) => {
  const frames = new Map<number, HTMLElement>();
  const buttons = new Map<number, HTMLButtonElement>();
  const fails = new Map<number, (message: string | null) => void>();
  const tops = new Map<number, number>();
  let refocus: number | null = null;
  /** A pointer drop already showed the rows in their places, so the refetch has nothing to slide. */
  let dropped = false;

  const measure = () => frames.forEach((el, id) => tops.set(id, el.offsetTop));

  /** Slides each row from where it shows now to where the refetched list puts it; a slide still running continues from its place on screen (U156). */
  const settle = () => {
    for (const [id, el] of frames) {
      const top = el.offsetTop;
      const was = tops.get(id);
      const shown = offsetOf(el);

      tops.set(id, top);

      if (dropped || was === undefined || source.reducedMotion() || !("animate" in el)) continue;

      const delta = was + shown - top;

      el.getAnimations().forEach((animation) => animation.cancel());

      if (Math.abs(delta) >= 1) el.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration: REORDER_MS, easing: REORDER_EASING });
    }

    if (refocus !== null) buttons.get(refocus)?.focus();

    refocus = null;
    dropped = false;
  };

  createEffect(on(() => source.ids().join(), settle, { defer: true }));

  /** One `todo.reorder` putting `id` at index `to` of the list. */
  const move = async (id: number, to: number) => {
    const message = await source.call({ id, before: beforeOf(source.all(), source.ids(), id, to) });

    fails.get(id)?.(message);

    if (message !== null) {
      refocus = null;
      dropped = false;
      buttons.get(id)?.focus();
    }
  };

  /** `by` places from the row's own, one call; nothing past either end. */
  const step = (id: number, by: -1 | 1) => {
    const to = source.ids().indexOf(id) + by;

    if (to < 0 || to >= source.ids().length) return;
    measure();
    refocus = id;
    void move(id, to);
  };

  return {
    /** Shows `message` (null clears) on `id`'s row. */
    fail: (id: number, message: string | null) => fails.get(id)?.(message),
    /** The open button of `id`'s row. */
    button: (id: number) => buttons.get(id),
    /** The Sortable's new order of the ids: the row it moved goes to its index. */
    order: (next: readonly string[]) => {
      const before = source.ids().map(String);
      const at = next.findIndex((id, index) => id !== before[index]);
      const moved = [next[at], before[at]].find((id) => id !== undefined && before.filter((other) => other !== id).join() === next.filter((other) => other !== id).join());

      if (moved === undefined) return;
      refocus = Number(moved);
      dropped = true;
      void move(refocus, next.indexOf(moved));
    },
    row: (id: number, parts: Parts): SortedRow => ({
      frame: (el) => {
        if (el) {
          frames.set(id, el);
          parts.ref(el);
        } else {
          frames.delete(id);
          tops.delete(id);
        }
      },
      button: (el) => {
        if (el) {
          buttons.set(id, el);
        } else {
          buttons.delete(id);
          fails.delete(id);
        }

        parts.handleRef(el ?? undefined);
      },
      fail: (show) => fails.set(id, show),
      key: (event) => {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;

        event.preventDefault();
        step(id, event.key === "ArrowUp" ? -1 : 1);
      },
      step: (by) => step(id, by),
      canStep: (by) => {
        const at = source.ids().indexOf(id) + by;

        return at >= 0 && at < source.ids().length;
      },
    }),
  };
};
