import { createSignal } from "solid-js";

/** A signal whose reads return what was last written. rc.21 reads lag writes until flush, so a call that follows its own write would otherwise see the old value; a read still tracks the signal, which shows the value once the write settles. */
export const createReadYourWrites = <K, V>(initial: ReadonlyMap<K, V>) => {
  let kept = initial;
  const [signal, setSignal] = createSignal(initial);

  const read = () => {
    signal();

    return kept;
  };

  const write = (next: ReadonlyMap<K, V>) => {
    kept = next;
    setSignal(next);
  };

  return [read, write] as const;
};

