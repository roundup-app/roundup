import { hidePopover, showPopover } from "@dnd-kit/dom/utilities";

/** Puts `element` at offset `by`: sliding there from where it is drawn when `slide`, else at once. */
type Move = (element: HTMLElement, by: { x: number; y: number }, slide: boolean) => void;

/**
 * One line in the top layer along a dragged row's top edge. Its box spans the row's width at lift and rides with the row (`ride`);
 * the line starts at a place inside it (`place`) and runs to the box's right edge, which cuts it off.
 * The start moves from where it is drawn (`move`); the line fades in where it first shows and out where it last showed, on the caller's `motion`, which is 0 ms under reduced motion.
 */
export const dropLine = (move: Move, motion: () => { duration: number; easing: string }) => {
  let box: HTMLElement | undefined;
  let bar: HTMLElement | undefined;
  let left = 0;
  let half = 0;
  let on = false;
  // Where the line starts, in view coordinates, or null before the first `place` of a drag.
  let at: number | null = null;
  let opened = 0;
  let fade: Animation | undefined;

  const fadeTo = (to: number) => {
    if (!bar) return;
    const from = Number.parseFloat(getComputedStyle(bar).opacity);
    const { duration, easing } = motion();

    fade?.cancel();
    bar.style.opacity = String(to);

    if (duration > 0 && Math.abs(from - to) > 0.01) fade = bar.animate({ opacity: [from, to] }, { duration, easing });
  };

  // The line paints over a dragged row only if it joins the top layer after it, and a drag library may show its dragged row after the drag starts.
  const raise = (open: number) => { if (open === opened && box) { hidePopover(box); showPopover(box); } };

  return {
    box: (element: HTMLElement) => { box = element; },
    bar: (element: HTMLElement) => { bar = element; },
    /** Opens the line over a row whose box at lift is `row`, in view coordinates; it shows nothing until the first `place`. */
    open: (row: DOMRect) => {
      if (!box || !bar) return;
      const open = ++opened;

      left = row.left;
      on = false;
      at = null;
      fade?.cancel();
      bar.style.opacity = "0";
      Object.assign(box.style, { left: `${row.left}px`, width: `${row.width}px` });
      raise(open);
      half = box.offsetHeight / 2;
      requestAnimationFrame(() => raise(open));
    },
    /** Centres the line on `top`, the dragged row's top edge in view coordinates, at once: the line moves with the row. */
    ride: (top: number) => {
      if (box) box.style.translate = `0 ${top - half}px`;
    },
    /** Starts the line at `x`, in view coordinates: sliding from where it is drawn, or at once with a fade in when it was hidden; a slide under way to `x` runs on. `null` fades it out where it is. `shows` names what it marks, for observers. */
    place: (x: number | null, shows: string) => {
      if (!box || !bar) return;
      box.dataset.shows = shows;

      if (x === null) {
        if (on) { on = false; fadeTo(0); }

        return;
      }

      if (x !== at) move(bar, { x: x - left, y: 0 }, on);
      at = x;

      if (!on) { on = true; fadeTo(1); }
    },
    /** Names where the drop's depth steps, for observers: `level:down:up` per step, in view coordinates. */
    steps: (steps: readonly { level: number; down: number; up: number }[]) => {
      const named = steps.map(step => `${step.level}:${step.down.toFixed(1)}:${step.up.toFixed(1)}`).join(" ");

      if (box && box.dataset.steps !== named) box.dataset.steps = named;
    },
    /** Fades the line out where it is, then takes it out of the top layer unless it opened again since. */
    close: () => {
      const shut = box, open = opened;

      if (!shut) return;
      on = false;
      fadeTo(0);
      setTimeout(() => { if (open === opened) hidePopover(shut); }, motion().duration);
    },
    /** Takes the line out of the top layer at once. */
    remove: () => {
      opened++;

      if (box) hidePopover(box);
    },
  };
};
