import { createComputed, createContext, createMemo, createSignal, on, onCleanup, useContext } from "solid-js";
import type { Accessor } from "solid-js";

export type Clock = () => number;

/** Elapsed times read in whole minutes (`elapsed`), so a coarse tick is enough. */
export const NOW_TICK_MS = 15_000;

type Subscribe = (active: Accessor<boolean>) => Accessor<number>;

/** Outside the App's provider (a row mounted alone) the age is a one-off read of the wall clock that never ticks. */
export const DisplayClockContext = createContext<Subscribe>(() => () => Date.now());

/** Call inside the App's Solid owner. Demand lasts while active; disposal releases it automatically. */
export const useDisplayNow = (active: Accessor<boolean>): Accessor<number> => useContext(DisplayClockContext)(active);

/** One shared timer for the whole app; the injected `clock` is the only source of time. */
export const createNow = (clock: Clock, isLive: Accessor<boolean> = () => true, visible: Accessor<boolean> = () => true): Accessor<number> & { subscribe: Subscribe } => {
  const [now, setNow] = createSignal(clock());
  const [demands, setDemands] = createSignal(0);
  createComputed(on(createMemo(() => visible() && (isLive() || demands() > 0)), (live) => {
    if (!live) return;

    setNow(clock());
    const timer = setInterval(() => setNow(clock()), NOW_TICK_MS);

    onCleanup(() => clearInterval(timer));
  }));

  const subscribe: Subscribe = (active) => {
    createComputed(on(active, (live) => {
      if (!live) return;

      setDemands((count) => count + 1);
      onCleanup(() => setDemands((count) => count - 1));
    }));

    return now;
  };

  return Object.assign(now, { subscribe });
};
