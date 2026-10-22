import { createComputed, createEffect, createSignal, on, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";

/** One clock for a whole finish: the longest effect, `--duration-bar`, read from the computed Tokens so no literal repeats it. */
const finishMs = (): number => {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--duration-bar").trim();
  const ms = value.endsWith("ms") ? parseFloat(value) : parseFloat(value) * 1000;

  return Number.isFinite(ms) ? ms : 0;
};

/**
 * U3770: which rows and whether the bar play a finish. `done` is the set of done Todo ids in the shown scope, `key` names that scope and
 * A first load, a scope change and a refetch that changes no `done` state only
 * re-baseline, so nothing moves at rest; a change plays, and a later one joins the same play instead of queueing another.
 */
export const createFinishMotion = (input: { loaded: Accessor<boolean>; key: Accessor<string>; done: Accessor<ReadonlySet<number>>; reduced: Accessor<boolean> }) => {
  const [rows, setRows] = createSignal<ReadonlySet<number>>(new Set());
  const [bar, setBar] = createSignal(false);
  let before: { key: string; done: ReadonlySet<number> } | null = null;

  let timer: ReturnType<typeof setTimeout> | undefined;

  const settle = () => {
    clearTimeout(timer);
    setRows(new Set<number>());
    setBar(false);
  };

  createEffect(on(input.reduced, (reduced) => { if (reduced) settle(); }));

  // A computation, not an effect: `bar` flips in the same pass as the fill value, so the fill's transition is in place when its new scale lands.
  createComputed(on([input.loaded, input.key, input.done], ([loaded, key, done]) => {
    const was = before;

    before = loaded ? { key, done } : null;

    if (was === null || was.key !== key) return settle();

    const seen = [...done].filter((id) => !was.done.has(id)).concat([...was.done].filter((id) => !done.has(id)));

    if (seen.length === 0 || input.reduced()) return;

    setRows(new Set([...rows(), ...seen]));
    setBar(bar() || done.size !== was.done.size);
    clearTimeout(timer);
    timer = setTimeout(settle, finishMs());
  }));

  onCleanup(() => clearTimeout(timer));

  return { row: (id: number) => rows().has(id), bar, settle };
};
