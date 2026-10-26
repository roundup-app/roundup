import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

const [count, setCount] = createSignal(0);

/** Z3799e: true while any menu or the switcher is open. The controls own the state; readers never scan the document. */
export const surfaceOpen = (): boolean => count() > 0;

/** Z3799e: counts the calling control while `open()` holds. */
export const trackSurface = (open: Accessor<boolean>): void => {
  createEffect(() => {
    if (!open()) return;
    setCount((value) => value + 1);
    onCleanup(() => setCount((value) => value - 1));
  });
};
