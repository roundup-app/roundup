import "./styles.css";

import type { Tokens } from "marked";
import { createEffect, createSignal, For, lazy, Loading, onCleanup, Show, untrack, type Accessor } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { animate } from "motion";
import { DrawerExpandContext } from "../drawer/DrawerHost";
import { Icon } from "../ink/Icon";
import { appSettings } from "../settings/preferences";
import { createCut } from "../ink/Tip";
import { Collapsible } from "../ui/Collapsible";
import { Tip } from "../ui/Tip";
import { durationMs, easingOutCurve } from "../ui/reorderMotion";
import { copy } from "./copy";
import { stepOfHeading, walkSteps, type WalkStep } from "./walkSteps";
import type { walkStorage } from "./walkStorage";
import type { PadEditorHandle } from "./PadRichEditor";

const PadRichEditor = lazy(() => import("./PadRichEditor"));

/** Below this pane width the outline and a step column do not fit side by side, so the outline folds into one row (PW8). */
const SIDE_BY_SIDE = 720;

/** U8080a: a heading's inline tokens as the Pad draws them; a link shows its words only. */
const Marks = (props: { marks: readonly Tokens.Generic[] }) => <For each={props.marks}>{token => {
  const inner = () => token.tokens ? <Marks marks={token.tokens} /> : token.text ?? token.raw;

  if (token.type === "codespan") return <code class="walk-code">{token.text}</code>;

  if (token.type === "strong") return <strong>{inner()}</strong>;

  if (token.type === "em") return <em>{inner()}</em>;

  if (token.type === "del") return <del>{inner()}</del>;

  return inner();
}}</For>;

const Row = (props: { step: WalkStep; done: boolean; current: boolean; onPick: () => void }) => {
  const [ref, cut] = createCut();

  return (
    <Tip kind="changing" text={props.step.title} cut={cut}>
      {trigger => (
        <button {...trigger()} type="button" data-button="quiet" class="walk-item" data-done={props.done ? "" : undefined} aria-current={props.current ? "step" : undefined} onClick={props.onPick}>
          <span class="walk-mark" aria-hidden="true"><Show when={props.done}><Icon name="check" /></Show></span>
          <span class="walk-item-title" ref={ref}><Marks marks={props.step.marks} /></span>
        </button>
      )}
    </Tip>
  );
};

/** PW1 to PW6: a Pad read one top-level step at a time, forward and back, read-only. `onFinish` runs once per finish; the caller decides where focus goes (PW5). */
export const Walk = (props: { name: string; text: string; storage: ReturnType<typeof walkStorage>; reducedMotion: Accessor<boolean>; onFinish: () => void; /** PW11: opens at the step holding this heading, else at the saved step. */ heading?: string | undefined; /** PW12: a step to open at, ahead of the heading and the saved step. */ at?: number | undefined; /** PW5: a walk opened with no link stays open at step 1 after Finish. */ stays?: boolean; /** PW12: the walk's Edit key. */ onEdit?: () => void }) => {
  const steps = untrack(() => walkSteps(props.text, props.name));
  const last = steps.length - 1;
  const stepAt = (at: number) => steps[at] ?? steps[last] ?? { title: props.name, text: props.text, marks: [{ type: "text", raw: props.name, text: props.name }] };
  const saved = untrack(() => props.storage.read()?.[props.name]);
  const opened = untrack(() => props.at ?? (props.heading === undefined ? -1 : stepOfHeading(steps, props.heading)));
  const [index, setIndex] = createSignal(Math.min(Math.max(opened >= 0 ? opened : (saved ?? 1) - 1, 0), last));
  let root: HTMLElement | undefined;
  let slide: HTMLDivElement | undefined;
  let body: HTMLDivElement | undefined;
  let editor: PadEditorHandle | undefined;
  let motion: { stop: () => void } | undefined;
  let finished = false;
  const [folded, setFolded] = createSignal(false);
  const [listOpen, setListOpen] = createSignal(false);
  const [more, setMore] = createSignal(false);

  // PW10: the fade shows while more of the step lies below the scroll position.
  // The editor's own surface scrolls inside the body; before it mounts the body is the scroller.
  const scroller = () => body?.querySelector<HTMLElement>(".pad-editor") ?? body;

  const measure = () => {
    const el = scroller();

    setMore(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 1);
  };

  const watch = (el: HTMLElement) => {
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => { setFolded((el.clientWidth || Infinity) < SIDE_BY_SIDE); measure(); });

    queueMicrotask(() => {
      observer.observe(el);

      if (body) observer.observe(body);
    });
    onCleanup(() => observer.disconnect());
  };

  const remember = (step: number | null) => {
    const all = { ...props.storage.read() };

    if (step === null) delete all[props.name];
    else all[props.name] = step;

    void props.storage.write(all);
  };

  if (opened >= 0) untrack(() => remember(Math.min(opened, last) + 1));

  // A Back that leaves at step 1 takes focus with it; the walk takes it back, so the keys keep working.
  createEffect(() => stepAt(index()).text, text => {
    editor?.setText(text);

    const el = scroller();

    if (el) el.scrollTop = 0;
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

    if (props.stays) {
      finished = false;
      setIndex(0);
    }
  };

  const next = () => (index() === last ? finish() : go(index() + 1));

  /** PW12: E opens the editor. */
  const editKey = (event: KeyboardEvent, onButton: boolean) => {
    if (event.key.toLowerCase() !== "e" || !props.onEdit || onButton) return false;

    props.onEdit();

    return true;
  };

  const stepKey = (event: KeyboardEvent, onButton: boolean) => {
    if (event.key === "ArrowRight" && index() < last) go(index() + 1);
    else if (event.key === "ArrowLeft") go(index() - 1);
    else if (event.key === "Enter" && index() === last && !onButton) finish();
    else return false;

    return true;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    const onButton = event.target instanceof Element && event.target.closest("button") !== null;

    if (editKey(event, onButton) || stepKey(event, onButton)) event.preventDefault();
  };

  const outline = () => (
    <div class="walk-steps">
      <For each={steps}>{(step, at) => <Row step={step} done={at() < index()} current={at() === index()} onPick={() => { go(at()); setListOpen(false); }} />}</For>
    </div>
  );

  return (
    <section class="walk" ref={el => { root = el; watch(el); }} tabindex="-1" aria-label={props.name} data-walk data-step={index() + 1} data-steps={steps.length} data-folded={folded() ? "" : undefined} onKeyDown={onKeyDown}>
      <nav class="walk-outline" aria-label={copy.walkOutline}>
        <Show when={folded()} fallback={<><Show when={!props.stays}><h2 class="walk-name">{props.name}</h2></Show>{outline()}</>}>
          <Collapsible.Root open={listOpen()} onOpenChange={open => setListOpen(open)}>
            <Collapsible.Trigger data-button="quiet" class="walk-fold">{copy.walkFolded(index() + 1, steps.length)}<Marks marks={stepAt(index()).marks} /></Collapsible.Trigger>
            <Collapsible.Content>{outline()}</Collapsible.Content>
          </Collapsible.Root>
        </Show>
      </nav>
      <div class="walk-main" data-pad-width={appSettings().padWidth}>
        <div class="walk-step" ref={slide}>
          <header class="walk-head">
            <h2 class="walk-title"><Marks marks={stepAt(index()).marks} /></h2>
            <Show when={!folded()}><span class="walk-count" aria-live="polite">{copy.walkCount(index() + 1, steps.length)}</span></Show>
          </header>
          <div class="walk-body pad-body" ref={el => { body = el; makeEventListener(el, "scroll", measure, { capture: true }); }} data-more={more() ? "" : undefined}>
            <DrawerExpandContext value={null}><Loading>
              <PadRichEditor label={props.name} text={stepAt(index()).text} readonly onChange={() => {}} onText={() => {}} onBlur={() => {}} onReady={ready => { editor = ready; ready.setText(stepAt(index()).text); queueMicrotask(measure); }} />
            </Loading></DrawerExpandContext>
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
