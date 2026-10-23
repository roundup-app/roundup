import { createComputed, createEffect, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";

/** U3770: diff refetched completion states, retaining each visible finishing row's place until its CSS strike ends. Scope changes and first loads settle without playing. */
export const createFinishMotion = (input: {
  loaded: Accessor<boolean>;
  key: Accessor<string>;
  done: Accessor<ReadonlySet<number>>;
  open: Accessor<readonly number[]>;
  reduced: Accessor<boolean>;
  shown: (id: number, wasDone: boolean) => boolean;
}) => {
  const [rows, setRows] = createSignal<ReadonlyMap<number, number>>(new Map());
  const [order, setOrder] = createSignal<readonly number[]>([]);
  const [bar, setBar] = createSignal(false);
  let before: { key: string; done: ReadonlySet<number> } | null = null;

  const settle = () => {
    setRows(new Map());
    setOrder([...input.open()]);
    setBar(false);
  };

  const rowEnded = (id: number) => {
    if (!rows().has(id)) return;

    setRows(new Map([...rows()].filter(([other]) => other !== id)));

    if (before?.done.has(id)) setOrder(order().filter(other => other !== id));
  };

  createEffect(on(input.reduced, (reduced) => { if (reduced) settle(); }));

  // A computation installs the fill's transition before the new scale lands; CSS events release the holds without a timer.
  createComputed(on([input.loaded, input.key, input.done, input.open], ([loaded, key, done, open]) => {
    const was = before;

    before = loaded ? { key, done } : null;

    if (!loaded || was === null || was.key !== key || input.reduced()) return settle();

    const changed = [...done].filter(id => !was.done.has(id)).concat([...was.done].filter(id => !done.has(id)));
    const shown = changed.filter(id => input.shown(id, was.done.has(id)));

    if (changed.length > 0 && shown.length === 0) return settle();

    const playing = new Map([...rows()].filter(([id]) => open.includes(id) || done.has(id)));

    for (const id of shown) if (!playing.has(id)) playing.set(id, order().indexOf(id));

    const listed = [...open];

    for (const [id, place] of [...playing].sort((a, b) => a[1] - b[1])) {
      if (done.has(id)) listed.splice(place < 0 ? listed.length : Math.min(place, listed.length), 0, id);
    }

    setRows(playing);
    setOrder(listed);

    if (shown.length > 0) setBar(bar() || done.size !== was.done.size);
  }));

  return { order, row: (id: number) => rows().has(id), bar, settle, rowEnded, barEnded: () => setBar(false) };
};

/** U3811: retarget a changing count from its visible pose during a completion burst. */
export const createCountMotion = (value: Accessor<string>, playing: Accessor<boolean>) => {
  let count: HTMLElement | undefined;

  createEffect(on(value, () => {
    if (!playing() || !count) return;

    // Keep a burst's newest text moving from the visible pose, rather than replaying the roll's hidden start.
    const style = getComputedStyle(count);
    const pose = { opacity: style.opacity, transform: style.transform };

    for (const animation of count.getAnimations?.() ?? []) {
      if (animation.playState !== "running" || !(animation.effect instanceof KeyframeEffect)) continue;

      animation.effect.setKeyframes([{ ...pose, easing: animation.effect.getKeyframes()[0]!.easing }, { opacity: "1", transform: "none" }]);
      animation.currentTime = 0;
    }
  }, { defer: true }));

  return (element: HTMLElement) => { count = element; };
};
