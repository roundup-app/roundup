import { createEffect, createSignal, onCleanup } from "solid-js";

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

  createEffect(() => {
    const el = box();

    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    const extra = options.watch?.(el);

    if (extra) observer.observe(extra);
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  return { ref: setBox, title: () => (cut() ? text() : undefined) };
};
