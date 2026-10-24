import { createEffect, createSignal } from "solid-js";

/** P3557c: one failure line about at most one item. It goes when that item is gone, when a later save of it is acknowledged, or when dismissed; a failure with no item stays until `clear`. */
export const createItemFailure = (exists: (item: string) => boolean) => {
  const [state, setState] = createSignal<{ message: string; item: string | null } | null>(null);

  const live = () => {
    const current = state();

    return current !== null && (current.item === null || exists(current.item)) ? current : null;
  };

  createEffect(() => {
    if (state() !== null && live() === null) setState(null);
  });

  return {
    message: () => live()?.message ?? null,
    show: (message: string, item: string | null = null) => setState({ message, item }),
    /** An acknowledged save, or any success, of `item` clears only a failure about it. */
    acknowledge: (item: string) => {
      if (state()?.item === item) setState(null);
    },
    clear: () => setState(null),
  };
};
