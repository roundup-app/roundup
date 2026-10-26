import { createResizeObserver } from "@solid-primitives/resize-observer";
import { createEffect, createSignal } from "solid-js";

/** U2228a, U3296b: a text cut to `…` in the layout it has now puts its full text in the native `title`; a text that fits has none. */
export const createCutTitle = (text: () => string, options: { track?: () => void; watch?: (box: HTMLElement) => Element | null } = {}) => {
  const [box, setBox] = createSignal<HTMLElement>();
  const [cut, setCut] = createSignal(false);

  const measure = () => {
    const el = box();

    setCut(!!el && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight));
  };

  createEffect(() => {
    text();
    options.track?.();
    box();
    queueMicrotask(measure);
  });

  if (typeof ResizeObserver !== "undefined") createResizeObserver(() => {
    const el = box();

    return el ? [el, options.watch?.(el)] : [];
  }, measure);

  const title = () => (cut() ? text() : undefined);

  /** Spread on the cut element: its `ref` and, only while cut, its `title`. */
  return { ref: setBox, title, attrs: () => ({ ref: setBox, title: title() }) };
};
