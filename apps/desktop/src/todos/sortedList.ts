import { createEffect, createRenderEffect, createSignal, on, onCleanup } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import type { Sortable } from "../ui";
import { beforeOf } from "./beforeOf";

/** U156: the layout animation of a row that changed place, the one U53 gives a row below a completed one. */
export const REORDER_MS = 150;

export const REORDER_EASING = "ease-out";

type Parts = Parameters<Parameters<typeof Sortable.Item>[0]["children"]>[0];

type Fail = (message: string | null) => void;

type Home = { element: HTMLElement; home: string | null };

/** U490a: what a list hands one row it orders through `ui/Sortable`. */
export type SortedRow = {
  /** The row's frame, which the Sortable drags and the keyboard move slides. */
  frame: (el: HTMLElement | null) => void;
  /** The row button: the Sortable's handle, and the element that keeps focus after a move. */
  button: (el: HTMLButtonElement | null) => void;
  /** Where the row reports a failed move; the row shows it in place of its `Waits on` line. */
  onFail: (fail: Fail) => void;
  /** `⌥↑` and `⌥↓` on the row button. */
  key: (event: KeyboardEvent) => void;
  /** The Move up and Move down controls; each is off at the end of the list it would move past. */
  step: (direction: -1 | 1) => void;
  canStep: (direction: -1 | 1) => boolean;
};

/** The vertical offset a computed `transform` holds, 0 for none. */
const offsetOf = (el: Element): number => {
  const match = /matrix\(([^)]+)\)/.exec(getComputedStyle(el).transform);

  return match ? Number(match[1]!.split(",")[5]) || 0 : 0;
};

/** The id a new order moved: the one whose removal leaves both orders equal. Adjacent swaps name either row; the call that results is the same order. */
export const movedBy = (before: readonly string[], after: readonly string[]): string | undefined => {
  const at = after.findIndex((id, index) => id !== before[index]);

  if (at < 0) return undefined;

  const without = (ids: readonly string[], id: string) => ids.filter((other) => other !== id).join("\0");

  return [after[at]!, before[at]!].find((id) => without(before, id) === without(after, id));
};

/**
 * U155, U156, U362, U490a: one ordered list of Todos on `ui/Sortable`. The primitive owns pointer and drag state; this turns its new order into one
 * `todo.reorder`, moves a row by `⌥` chord or control, slides rows the refetch moved, and (Shelf only) drops a row on a Home of the Rail.
 */
export const createSortedList = (source: {
  ids: () => number[];
  all: () => readonly Todo[];
  call: (params: { id: number; before: number | null }) => Promise<string | null>;
  reducedMotion: () => boolean;
  /** U362: the Rail target under a point and the move it receives, only for Shelf rows. */
  home?: {
    target: (id: number, x: number, y: number) => Home | null;
    move: (id: number, home: string | null) => Promise<string | null>;
  };
}) => {
  const frames = new Map<number, HTMLElement>();
  const buttons = new Map<number, HTMLButtonElement>();
  const fails = new Map<number, Fail>();
  const tops = new Map<number, number>();
  let refocus: number | null = null;
  let slide = false;
  const [movedFocus, setMovedFocus] = createSignal<{ id: number; home: string | null; element: HTMLElement } | null>(null);

  /** Slides each row from where it showed to where the list now puts it. */
  const settle = () => {
    for (const [id, el] of frames) {
      const top = el.offsetTop;
      const was = tops.get(id);
      const shown = offsetOf(el);

      tops.set(id, top);

      if (!slide || was === undefined || source.reducedMotion() || !("animate" in el)) continue;

      const delta = was + shown - top;

      el.getAnimations().forEach((animation) => animation.cancel());

      if (Math.abs(delta) >= 1) el.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration: REORDER_MS, easing: REORDER_EASING });
    }

    slide = false;

    if (refocus !== null) buttons.get(refocus)?.focus();

    refocus = null;
  };

  createEffect(on(source.ids, settle, { defer: true }));
  createEffect(() => {
    const request = movedFocus();

    if (!request || source.all().find((todo) => todo.id === request.id)?.home !== request.home) return;
    setMovedFocus(null);
    queueMicrotask(() => {
      if (document.activeElement === document.body || document.activeElement === null) {
        (source.ids().includes(request.id) ? buttons.get(request.id) : request.element)?.focus();
      }
    });
  });

  const failed = (id: number, message: string | null) => {
    fails.get(id)?.(message);

    if (message !== null) {
      refocus = null;
      slide = false;
      buttons.get(id)?.focus();
    }
  };

  const run = async (id: number, to: number) => {
    failed(id, await source.call({ id, before: beforeOf(source.all(), source.ids(), id, to) }));
  };

  const step = (id: number, direction: -1 | 1) => {
    const to = source.ids().indexOf(id) + direction;

    if (to < 0 || to >= source.ids().length) return;

    frames.forEach((el, other) => tops.set(other, el.offsetTop));
    slide = true;
    refocus = id;
    void run(id, to);
  };

  const moveHome = async (id: number, target: Home) => {
    setMovedFocus({ id, home: target.home, element: target.element });
    buttons.get(id)?.focus();

    const message = await source.home!.move(id, target.home);

    fails.get(id)?.(message);

    if (message !== null) setMovedFocus(null);

    // A refetch can remove the focused row before the RPC resolves.
    if (document.activeElement === document.body || document.activeElement === null) target.element.focus();
  };

  /** While the primitive drags `id`, marks the Home under the pointer, and on release over a Home (or outside the list) takes the drop from the primitive. */
  const watchDrag = (id: number, parts: Parts) => {
    // A render effect: the primitive subscribes to `isDragging` when its own effect first runs, so it must have been read by then.
    createRenderEffect(() => {
      if (!parts.isDragging() || !source.home) return;

      let target: Home | null = null;

      const mark = (next: Home | null) => {
        target?.element.removeAttribute("data-todo-drop");
        target = next;
        target?.element.setAttribute("data-todo-drop", "");
      };

      const move = (event: PointerEvent) => mark(source.home!.target(id, event.clientX, event.clientY));

      const release = (event: PointerEvent) => {
        const found = source.home!.target(id, event.clientX, event.clientY);
        const bounds = frames.get(id)?.parentElement?.getBoundingClientRect();
        const inside = bounds !== undefined && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;

        if (found === null && inside) return;

        // The library restores the row; a release over a Home moves the Todo there instead.
        parts.sortable.manager?.actions.stop({ canceled: true });

        if (found !== null) void moveHome(id, found);
      };

      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", release, true);
      onCleanup(() => {
        mark(null);
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", release, true);
      });
    });
  };

  return {
    /** The Sortable's new order of the list: one `todo.reorder` for the row it moved. */
    order: (next: readonly string[]) => {
      const before = source.ids().map(String);
      const moved = movedBy(before, next);

      if (moved === undefined) return;

      slide = false;
      refocus = Number(moved);
      void run(Number(moved), next.indexOf(moved));
    },
    row: (id: number, parts: Parts): SortedRow => {
      watchDrag(id, parts);

      return {
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
          if (el) buttons.set(id, el);
          else {
            buttons.delete(id);
            fails.delete(id);
          }

          parts.handleRef(el ?? undefined);
        },
        onFail: (fail) => fails.set(id, fail),
        key: (event) => {
          if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;

          event.preventDefault();
          step(id, event.key === "ArrowUp" ? -1 : 1);
        },
        step: (direction) => step(id, direction),
        canStep: (direction) => {
          const to = source.ids().indexOf(id) + direction;

          return to >= 0 && to < source.ids().length;
        },
      };
    },
  };
};
