import { KeyChip } from "../keys/KeyChip";
import { ariaChord, type Chord } from "../keys/chords";
import { createSignal, createUniqueId, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { createResizeObserver } from "@solid-primitives/resize-observer";

const scenes = {
  "strolling": new URL("./doodles/strolling.svg?no-inline", import.meta.url).href,
  "running": new URL("./doodles/running.svg?no-inline", import.meta.url).href,
  "reading-side": new URL("./doodles/reading-side.svg?no-inline", import.meta.url).href,
  "meditating": new URL("./doodles/meditating.svg?no-inline", import.meta.url).href,
  "sitting-reading": new URL("./doodles/sitting-reading.svg?no-inline", import.meta.url).href,
  "clumsy": new URL("./doodles/clumsy.svg?no-inline", import.meta.url).href,
  "plant": new URL("./doodles/plant.svg?no-inline", import.meta.url).href,
};

/** U4464: one named empty view; the owning surface supplies its next action. */
export const EmptyState = (props: { art: keyof typeof scenes; title: string; line?: string; action?: JSX.Element; actions?: readonly { label: string; chord: Chord; run: () => void }[] | undefined; available?: boolean | undefined }) => {
  const title = createUniqueId();

  let box!: HTMLDivElement;
  const [room, setRoom] = createSignal<HTMLElement>();
  const [targets, setTargets] = createSignal<Element[]>([]);
  const [visible, setVisible] = createSignal(false);

  const measure = () => {
    const surface = room();

    if (!surface) return;
    const bounds = surface.getBoundingClientRect();
    const unit = parseFloat(getComputedStyle(box).getPropertyValue("--space-6"));
    const content = [...surface.querySelectorAll<HTMLElement>(".empty-state-content,h3,p,button,li,[role=alert]")];
    const bottom = Math.max(...content.flatMap(el => { const rect = el.getBoundingClientRect();

 return rect.height > 0 ? [rect.bottom] : []; }));
    const top = Math.max(bounds.top, bounds.bottom - unit * 10.5);
    setVisible(bounds.height >= unit * 26 && top >= bottom + unit
      && surface.querySelectorAll(".empty-state").length + Number(surface.matches(".empty-state")) === 1
      && !surface.querySelector("[data-terminal-content]"));
    setTargets([surface, box, ...content]);
  };

  if (typeof ResizeObserver !== "undefined") createResizeObserver(targets, measure);

  onMount(() => {
    setRoom(box.closest<HTMLElement>(".choose-project,.shelf-area,.pane-body,.note-recovery,.draft-recovery") ?? box);
    const observer = new MutationObserver(measure);
    observer.observe(room()!, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-terminal-content"] });
    onCleanup(() => observer.disconnect());
    measure();
  });

  return <div ref={el => { box = el; }} class="empty-state" role="group" aria-labelledby={title}>
    <Show when={visible()}><Portal mount={room()} ref={el => { el.classList.add("empty-state-ground"); el.setAttribute("aria-hidden", "true"); }}><svg viewBox="0 0 1024 768" aria-hidden="true"><use href={`${scenes[props.art]}#scene`} width="1024" height="768" /></svg></Portal></Show>
    <div class="empty-state-content">
      <h3 id={title} class="empty-state-title">{props.title}</h3>
      <Show when={props.line}>{line => <p class="empty-state-line">{line()}</p>}</Show>
      <Show when={props.actions?.length}><div class="empty-state-actions"><For each={props.actions}>{(action, index) => <button type="button" data-button={index() === 0 ? "primary" : "quiet"} aria-label={action.label} aria-keyshortcuts={ariaChord(action.chord)} aria-disabled={props.available === false ? true : undefined} onClick={() => { if (props.available !== false) action.run(); }}>{action.label}<KeyChip keys={action.chord.keys} /></button>}</For></div></Show>
      <Show when={props.action}><div class="empty-state-actions">{props.action}</div></Show>
    </div>
  </div>;
};
