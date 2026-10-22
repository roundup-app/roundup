import { createEffect, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";

/**
 * U3770: which rows and whether the bar play a finish. `done` is the set of done Todo ids in the shown scope, `key` names that scope and
 * A first load, a scope change and a refetch that changes no `done` state only
 * re-baseline, so nothing moves at rest; a change plays, and a later one joins the same play instead of queueing another.
 */
export const createFinishMotion = (input: { loaded: Accessor<boolean>; key: Accessor<string>; done: Accessor<ReadonlySet<number>>; reduced: Accessor<boolean> }) => {
  const [rows, setRows] = createSignal<ReadonlySet<number>>(new Set());
  const [bar, setBar] = createSignal(false);
  let before: { key: string; done: ReadonlySet<number> } | null = null;

  const settle = () => {
    setRows(new Set<number>());
    setBar(false);
  };

  createEffect(on(input.reduced, (reduced) => { if (reduced) settle(); }));

  createEffect(on([input.loaded, input.key, input.done], ([loaded, key, done]) => {
    const was = before;

    before = loaded ? { key, done } : null;

    if (was === null || was.key !== key) return settle();

    const seen = [...done].filter((id) => !was.done.has(id)).concat([...was.done].filter((id) => !done.has(id)));

    if (seen.length === 0 || input.reduced()) return;

    setRows(new Set([...rows(), ...seen]));
    setBar(bar() || done.size !== was.done.size);
  }));

  return { row: (id: number) => rows().has(id), bar, settle };
};
