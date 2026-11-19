import "./styles.css";

import { createEffect, createSignal, For, lazy, Loading, onCleanup, Show, untrack, type Accessor } from "solid-js";
import { animate } from "motion";
import { Icon } from "../ink/Icon";
import { appSettings } from "../settings/preferences";
import { Collapsible } from "../ui/Collapsible";
import { durationMs, easingOutCurve } from "../ui/reorderMotion";
import { copy } from "./copy";
import { walkSteps } from "./walkSteps";
import type { walkStorage } from "./walkStorage";
import type { PadEditorHandle } from "./PadRichEditor";

const PadRichEditor = lazy(() => import("./PadRichEditor"));

/** Below this pane width the outline and a step column do not fit side by side, so the outline folds into one row (PW8). */
const SIDE_BY_SIDE = 720;

/** PW1 to PW6: a Pad read one top-level step at a time, forward and back, read-only. `onFinish` runs once per finish; the caller decides where focus goes (PW5). */
export const Walk = (props: { name: string; text: string; storage: ReturnType<typeof walkStorage>; reducedMotion: Accessor<boolean>; onFinish: () => void }) => {
  const steps = untrack(() => walkSteps(props.text, props.name));
  const last = steps.length - 1;
  const stepAt = (at: number) => steps[at] ?? steps[last] ?? { title: props.name, text: props.text };
  const saved = untrack(() => props.storage.read()?.[props.name]);
  const [index, setIndex] = createSignal(Math.min(Math.max((saved ?? 1) - 1, 0), last));
  let root: HTMLElement | undefined;
  let slide: HTMLDivElement | undefined;
  let scroller: HTMLDivElement | undefined;
  let editor: PadEditorHandle | undefined;
  let motion: { stop: () => void } | undefined;
  let finished = false;
  const [folded, setFolded] = createSignal(false);
  const [listOpen, setListOpen] = createSignal(false);
  const [more, setMore] = createSignal(false);

  // PW10: the fade shows while more of the step lies below the scroll position.
  const measure = () => setMore(!!scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 1);

  const watch = (el: HTMLElement) => {
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => { setFolded((el.clientWidth || Infinity) < SIDE_BY_SIDE); measure(); });

    queueMicrotask(() => {
      observer.observe(el);

      if (scroller) observer.observe(scroller);
    });
    onCleanup(() => observer.disconnect());
  };

  const remember = (step: number | null) => {
    const all = { ...props.storage.read() };

    if (step === null) delete all[props.name];
    else all[props.name] = step;

    void props.storage.write(all);
  };

  // A Back that leaves at step 1 takes focus with it; the walk takes it back, so the keys keep working.
  createEffect(() => stepAt(index()).text, text => {
    editor?.setText(text);

    if (scroller) scroller.scrollTop = 0;
    queueMicrotask(measure);
  });
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
    // M11: the walk's one change reads its distance, time and curve from Tokens where it draws.
    const seconds = durationMs("--duration-layout", slide) / 1000;
    const shift = Number.parseFloat(tokens.getPropertyValue("--space-4"));

    if (!(seconds > 0)) return;
    motion = animate(slide, { opacity: [0, 1], transform: [`translateX(${to > from ? shift : -shift}px)`, "translateX(0px)"] }, { duration: seconds, ease: easingOutCurve(slide) });
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

  const outline = () => (
    <ol class="walk-steps">
      <For each={steps}>{(step, at) => (
        <li>
          <button type="button" data-button="quiet" class="walk-item" data-done={at() < index() ? "" : undefined} aria-current={at() === index() ? "step" : undefined} onClick={() => { go(at()); setListOpen(false); }}>
            <span class="walk-mark" aria-hidden="true"><Show when={at() < index()} fallback={at() === index() ? at() + 1 : null}><Icon name="check" /></Show></span>
            <span class="walk-item-title">{step.title}</span>
          </button>
        </li>
      )}</For>
    </ol>
  );

  return (
    <section class="walk" ref={el => { root = el; watch(el); }} tabindex="-1" aria-label={props.name} data-walk data-step={index() + 1} data-steps={steps.length} data-folded={folded() ? "" : undefined} onKeyDown={onKeyDown}>
      <nav class="walk-outline" aria-label={copy.walkOutline}>
        <Show when={folded()} fallback={<><h2 class="walk-name">{props.name}</h2>{outline()}</>}>
          <Collapsible.Root open={listOpen()} onOpenChange={open => setListOpen(open)}>
            <Collapsible.Trigger data-button="quiet" class="walk-fold">{copy.walkStep} {copy.walkCount(index() + 1, steps.length)} · {stepAt(index()).title}</Collapsible.Trigger>
            <Collapsible.Content>{outline()}</Collapsible.Content>
          </Collapsible.Root>
        </Show>
      </nav>
      <div class="walk-main" data-pad-width={appSettings().padWidth}>
        <div class="walk-step" ref={slide}>
          <header class="walk-head">
            <h2 class="walk-title">{stepAt(index()).title}</h2>
            <span class="walk-count" aria-live="polite">{copy.walkCount(index() + 1, steps.length)}</span>
          </header>
          <div class="walk-body pad-body" ref={scroller} data-more={more() ? "" : undefined} onScroll={measure}>
            <Loading>
              <PadRichEditor label={props.name} text={stepAt(index()).text} readonly onChange={() => {}} onText={() => {}} onBlur={() => {}} onReady={ready => { editor = ready; ready.setText(stepAt(index()).text); queueMicrotask(measure); }} />
            </Loading>
          </div>
        </div>
        <footer class="walk-foot">
          <Show when={index() > 0}>
            <button type="button" data-button="quiet" onClick={() => go(index() - 1)}>{copy.walkBack}</button>
          </Show>
          <span class="walk-keys">{copy.walkHint}</span>
          <button type="button" class="walk-next" data-button="primary" onClick={next}>
            <Show when={index() === last} fallback={copy.walkNext}>{copy.walkFinish}</Show>
          </button>
        </footer>
      </div>
    </section>
  );
};
