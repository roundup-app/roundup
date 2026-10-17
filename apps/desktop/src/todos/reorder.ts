import { createEffect, createSignal, on, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import { swallowNextClick } from "../ui";

/** U156: the layout animation of a row that changed place, the one U53 gives a row below a completed one. */
export const REORDER_MS = 150;

export const REORDER_EASING = "ease-out";

/** U155: a press that moves less than this is the click of U17. */
const THRESHOLD_PX = 4;

/** U155: `todo.reorder`'s `before` for putting `id` at index `to` of the list `listIds`: the next row of the list, else the Todo after the list's last row in `all`, else null. */
export const beforeOf = (all: readonly Todo[], listIds: readonly number[], id: number, to: number): number | null => {
  const others = listIds.filter((other) => other !== id);
  const next = others[to];

  if (next !== undefined) return next;

  const last = others.at(-1);
  const rest = all.filter((todo) => todo.id !== id);

  return (last === undefined ? undefined : rest[rest.findIndex((todo) => todo.id === last) + 1])?.id ?? null;
};

/** The vertical offset a computed `transform` holds, 0 for none. */
const offsetOf = (el: Element): number => {
  const match = /matrix\(([^)]+)\)/.exec(getComputedStyle(el).transform);

  return match ? Number(match[1]!.split(",")[5]) || 0 : 0;
};

export type Reorder = {
  /** The row's frame, for measuring and moving it. */
  frame: (id: number, el: HTMLElement | null) => void;
  /** The row button, which keeps focus after a keyboard move. */
  button: (id: number, el: HTMLButtonElement | null) => void;
  /** `⌥↑` and `⌥↓` on a row button; `fail` takes the message of a failed call, else null. */
  key: (id: number, event: KeyboardEvent, fail: (message: string | null) => void) => void;
  /** A press on a row button: past `THRESHOLD_PX` it drags within the list or onto a Home. */
  press: (id: number, event: PointerEvent, fail: (message: string | null) => void) => void;
};

/** U155, U156, U362: reorders within a list by pointer or keyboard, moves Shelf Todos onto Rail Homes, and settles rows when the refetched list arrives. */
export const createReorder = (source: {
  /** The ids of the list's rows, top to bottom. */
  ids: Accessor<readonly number[]>;
  /** Every Todo, in the Daemon's order. */
  all: Accessor<readonly Todo[]>;
  call: (params: { id: number; before: number | null }) => Promise<string | null>;
  reducedMotion: Accessor<boolean>;
  /** U362: an optional Rail target and the move it receives, only for Shelf rows. */
  home?: {
    target: (id: number, x: number, y: number) => { element: HTMLElement; home: string | null } | null;
    move: (id: number, home: string | null) => Promise<string | null>;
  };
}): Reorder => {
  const frames = new Map<number, HTMLElement>();
  const buttons = new Map<number, HTMLButtonElement>();
  const tops = new Map<number, number>();
  let refocus: number | null = null;
  const [movedFocus, setMovedFocus] = createSignal<{ id: number; home: string | null; element: HTMLElement } | null>(null);
  let stop: () => void = () => {};

  const measure = () => frames.forEach((el, id) => tops.set(id, el.offsetTop));

  /** Clears the offsets a drag left and slides each row from where it showed to where the list now puts it. */
  const settle = () => {
    for (const [id, el] of frames) {
      const top = el.offsetTop;
      const was = tops.get(id);
      const shown = offsetOf(el);

      el.style.transform = "";
      tops.set(id, top);

      if (was === undefined || source.reducedMotion() || !("animate" in el)) continue;

      const delta = was + shown - top;

      el.getAnimations().forEach((animation) => animation.cancel());

      if (Math.abs(delta) >= 1) el.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration: REORDER_MS, easing: REORDER_EASING });
    }

    if (refocus !== null) buttons.get(refocus)?.focus();

    refocus = null;
  };

  createEffect(on(source.ids, settle));
  createEffect(() => {
    const all = source.all();
    const ids = source.ids();
    const request = movedFocus();

    if (!request || all.find((todo) => todo.id === request.id)?.home !== request.home) return;
    setMovedFocus(null);
    queueMicrotask(() => {
      if (document.activeElement === document.body || document.activeElement === null) {
        (ids.includes(request.id) ? buttons.get(request.id) : request.element)?.focus();
      }
    });
  });
  onCleanup(() => stop());

  const run = async (id: number, to: number, fail: (message: string | null) => void) => {
    const message = await source.call({ id, before: beforeOf(source.all(), source.ids(), id, to) });

    fail(message);

    if (message !== null) {
      refocus = null;
      settle();
    }
  };

  return {
    frame: (id, el) => {
      if (el) frames.set(id, el);
      else {
        frames.delete(id);
        tops.delete(id);
      }
    },
    button: (id, el) => {
      if (el) buttons.set(id, el);
      else buttons.delete(id);
    },
    key: (id, event, fail) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;

      event.preventDefault();

      const list = source.ids();
      const to = list.indexOf(id) + (event.key === "ArrowUp" ? -1 : 1);

      if (to < 0 || to >= list.length) return;

      measure();
      refocus = id;
      void run(id, to, fail);
    },
    press: (id, press, fail) => {
      const el = frames.get(id);

      if (!el || press.button !== 0) return;

      stop();

      let dragging = false;
      let inList = true;
      let to = 0;
      let target: { element: HTMLElement; home: string | null } | null = null;

      const mark = (next: typeof target) => {
        target?.element.removeAttribute("data-todo-drop");
        target = next;
        target?.element.setAttribute("data-todo-drop", "");
      };

      const list = source.ids();
      const origin = list.indexOf(id);

      const follow = (move: PointerEvent) => {
        const dy = move.clientY - press.clientY;

        if (!dragging) {
          const distance = source.home ? Math.hypot(move.clientX - press.clientX, dy) : Math.abs(dy);

          if (distance < THRESHOLD_PX) return;

          dragging = true;
          measure();
        }

        mark(source.home?.target(id, move.clientX, move.clientY) ?? null);
        const bounds = el.parentElement!.getBoundingClientRect();
        const inside = move.clientX >= bounds.left && move.clientX <= bounds.right && move.clientY >= bounds.top && move.clientY <= bounds.bottom;

        if (source.home && !inside) {
          if (inList) settle();
          inList = false;

          return;
        }

        if (!inList) frames.forEach((row) => row.getAnimations?.().forEach((animation) => animation.cancel()));
        inList = true;

        const room = el.offsetHeight + (parseFloat(getComputedStyle(el.parentElement!).rowGap) || 0);
        const centre = el.offsetTop + dy + el.offsetHeight / 2;
        const others = list.filter((other) => other !== id);

        to = others.filter((other) => {
          const row = frames.get(other)!;

          return row.offsetTop + row.offsetHeight / 2 < centre;
        }).length;
        el.style.transform = `translateY(${dy}px)`;
        list.forEach((other, index) => {
          if (other === id) return;

          const shift = to < origin && index >= to && index < origin ? room : to > origin && index > origin && index <= to ? -room : 0;

          frames.get(other)!.style.transform = shift === 0 ? "" : `translateY(${shift}px)`;
        });
      };

      const finish = (drop: boolean, release?: PointerEvent) => {
        const home = drop && release ? source.home?.target(id, release.clientX, release.clientY) : null;
        stop();

        if (!dragging) return;

        if (home && source.home) {
          const move = source.home.move;
          setMovedFocus({ id, home: home.home, element: home.element });
          settle();
          buttons.get(id)?.focus();
          void move(id, home.home).then((message) => {
            fail(message);

            if (message !== null) setMovedFocus(null);

            // A refetch can remove the focused row before the RPC resolves.
            if (document.activeElement === document.body || document.activeElement === null) home.element.focus();
          });
          swallowNextClick();

          return;
        }

        swallowNextClick();

        const bounds = el.parentElement!.getBoundingClientRect();
        const inside = release !== undefined && release.clientY >= bounds.top && release.clientY <= bounds.bottom && release.clientX >= bounds.left && release.clientX <= bounds.right;

        if (drop && inside && to !== origin) void run(id, to, fail);
        else settle();
      };

      const release = (up: PointerEvent) => finish(true, up);
      const cancel = () => finish(false);

      const escape = (key: KeyboardEvent) => {
        if (key.key === "Escape") cancel();
      };

      stop = () => {
        mark(null);
        window.removeEventListener("pointermove", follow);
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", escape);
        stop = () => {};
      };

      window.addEventListener("pointermove", follow);
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", escape);
    },
  };
};
