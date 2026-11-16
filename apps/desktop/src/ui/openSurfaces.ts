import { createEffect, createSignal, type Accessor } from "solid-js";

const [count, setCount] = createSignal(0);

/** Z3799e: true while any menu or the switcher is open. The controls own the state; readers never scan the document. */
export const surfaceOpen = (): boolean => count() > 0;

/** Z3799e: counts the calling control while `open()` holds. */
export const trackSurface = (open: Accessor<boolean>): void => {
  createEffect(open, (opened) => {
    if (!opened) return;
    setCount((value) => value + 1);

    return () => setCount((value) => value - 1);
  });
};
