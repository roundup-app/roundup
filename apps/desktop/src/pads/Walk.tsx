import "./styles.css";

import { createEffect, createSignal, onCleanup, Show, untrack, type Accessor } from "solid-js";
import { animate } from "motion";
import { Markdown } from "../plain/Markdown";
import { copy } from "./copy";
import { walkSteps } from "./walkSteps";
import type { walkStorage } from "./walkStorage";

/** M11: the walk's one change reads its distance, time and curve from Tokens where it draws. */
const curve = (tokens: CSSStyleDeclaration): [number, number, number, number] => {
  const values = tokens.getPropertyValue("--easing-out").match(/[\d.]+/g) ?? [];

  return [Number(values[0]), Number(values[1]), Number(values[2]), Number(values[3])];
};

/** PW1 to PW6: a Pad read one top-level step at a time, forward and back, read-only. `onFinish` runs once per finish; the caller decides where focus goes (PW5). */
export const Walk = (props: { name: string; text: string; storage: ReturnType<typeof walkStorage>; reducedMotion: Accessor<boolean>; onFinish: () => void }) => {
  const steps = untrack(() => walkSteps(props.text, props.name));
  const last = steps.length - 1;
  const stepAt = (at: number) => steps[at] ?? steps[last] ?? { title: props.name, text: props.text };
  const saved = untrack(() => props.storage.read()?.[props.name]);
  const [index, setIndex] = createSignal(Math.min(Math.max((saved ?? 1) - 1, 0), last));
  let root: HTMLElement | undefined;
  let slide: HTMLDivElement | undefined;
  let motion: { stop: () => void } | undefined;
  let finished = false;

  const remember = (step: number | null) => {
    const all = { ...props.storage.read() };

    if (step === null) delete all[props.name];
    else all[props.name] = step;

    void props.storage.write(all);
  };

  // A Back that leaves at step 1 takes focus with it; the walk takes it back, so the keys keep working.
  createEffect(index, () => { if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true }); });
  onCleanup(() => motion?.stop());

  const go = (to: number) => {
    const from = index();

    if (to < 0 || to > last || to === from) return;
    // A key pressed mid-change shows its step at once: the running change ends where it is.
    motion?.stop();
    setIndex(to);
    remember(to + 1);

    if (props.reducedMotion() || !slide) return;

    const tokens = getComputedStyle(slide);
    const seconds = Number.parseFloat(tokens.getPropertyValue("--duration-layout")) / 1000;
    const shift = Number.parseFloat(tokens.getPropertyValue("--space-4"));

    if (!(seconds > 0)) return;
    motion = animate(slide, { opacity: [0, 1], transform: [`translateX(${to > from ? shift : -shift}px)`, "translateX(0px)"] }, { duration: seconds, ease: curve(tokens) });
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    remember(null);
    props.onFinish();
  };

  const next = () => (index() === last ? finish() : go(index() + 1));

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    const onButton = event.target instanceof Element && event.target.closest("button") !== null;

    if (event.key === "ArrowRight" && index() < last) go(index() + 1);
    else if (event.key === "ArrowLeft") go(index() - 1);
    else if (event.key === "Enter" && index() === last && !onButton) finish();
    else return;

    event.preventDefault();
  };

  return (
    <section class="walk" ref={root} tabindex="-1" aria-label={props.name} data-walk data-step={index() + 1} data-steps={steps.length} onKeyDown={onKeyDown}>
      <div class="walk-step" ref={slide}>
        <header class="walk-head">
          <h2 class="walk-title">{stepAt(index()).title}</h2>
          <span class="walk-count" aria-live="polite">{copy.walkCount(index() + 1, steps.length)}</span>
        </header>
        <div class="walk-body">
          <Markdown body={stepAt(index()).text} />
        </div>
      </div>
      <footer class="walk-foot">
        <Show when={index() > 0}>
          <button type="button" data-button="quiet" onClick={() => go(index() - 1)}>{copy.walkBack}</button>
        </Show>
        <button type="button" class="walk-next" data-button="primary" onClick={next}>
          <Show when={index() === last} fallback={copy.walkNext}>{copy.walkFinish}</Show>
        </button>
      </footer>
    </section>
  );
};
