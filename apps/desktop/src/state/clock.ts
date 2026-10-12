import { createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";

export type Clock = () => number;

/** Folding a `done` Agent reads whole minutes, so a coarse tick is enough. */
export const NOW_TICK_MS = 15_000;

/** One shared timer for the whole app; the injected `clock` is the only source of time. */
export const createNow = (clock: Clock): Accessor<number> => {
  const [now, setNow] = createSignal(clock());
  const timer = setInterval(() => setNow(clock()), NOW_TICK_MS);

  onCleanup(() => clearInterval(timer));

  return now;
};
