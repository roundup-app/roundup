import { createEffect, createSignal } from "solid-js";
import { debounce } from "@solid-primitives/scheduled";

/** True once `pending` has held a value for 150 ms: a different value starts the wait again, and `false` or `undefined` ends it. */
export const createLate = <Key>(pending: () => Key | false | undefined) => {
  const [late, setLate] = createSignal(false);
  const raise = debounce(() => setLate(true), 150);

  createEffect(pending, waiting => {
    raise.clear();
    setLate(false);

    if (waiting) raise();
  });

  return late;
};
