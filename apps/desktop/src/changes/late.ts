import { createEffect, createSignal } from "solid-js";
import { debounce } from "@solid-primitives/scheduled";

/** True once `pending` has held for 150 ms; false the moment it stops. */
export const createLate = (pending: () => boolean) => {
  const [late, setLate] = createSignal(false);
  const raise = debounce(() => setLate(true), 150);

  createEffect(pending, waiting => {
    if (waiting) {
      raise();
    } else {
      raise.clear();
      setLate(false);
    }
  });

  return late;
};
