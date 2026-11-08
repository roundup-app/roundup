import { createWritableMemo } from "@solid-primitives/memo";

/** State that starts over as `initial` whenever `key` changes and is written freely between: a writable memo of its key. */
export const createRestartable = <T>(key: () => unknown, initial: T) => createWritableMemo<T>(() => {
  key();

  return initial;
});
