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

export type Elapsed = { unit: "now" | "minutes" | "hours" | "days" | "weeks"; value: number } | { unit: "date"; date: string };

/** Last-change time and display time are Unix milliseconds. U4709a's whole-unit boundaries, shared by every age. */
export const elapsed = (updatedAt: number, now: number): Elapsed => {
  const seconds = Math.max(0, now - updatedAt) / 1000;

  if (seconds < 60) return { unit: "now", value: 0 };

  if (seconds < 3600) return { unit: "minutes", value: Math.floor(seconds / 60) };

  if (seconds < 86400) return { unit: "hours", value: Math.floor(seconds / 3600) };

  if (seconds < 604800) return { unit: "days", value: Math.floor(seconds / 86400) };

  if (seconds < 2419200) return { unit: "weeks", value: Math.floor(seconds / 604800) };
  const date = new Date(updatedAt);

  return { unit: "date", date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` };
};
