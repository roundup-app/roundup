import { createUniqueId, For, Show, type JSX } from "solid-js";

const scenes = {
  "strolling": new URL("./doodles/strolling.svg?no-inline", import.meta.url).href,
  "running": new URL("./doodles/running.svg?no-inline", import.meta.url).href,
  "reading-side": new URL("./doodles/reading-side.svg?no-inline", import.meta.url).href,
  "laying": new URL("./doodles/laying.svg?no-inline", import.meta.url).href,
  "unboxing": new URL("./doodles/unboxing.svg?no-inline", import.meta.url).href,
  "meditating": new URL("./doodles/meditating.svg?no-inline", import.meta.url).href,
  "sitting-reading": new URL("./doodles/sitting-reading.svg?no-inline", import.meta.url).href,
  "loving": new URL("./doodles/loving.svg?no-inline", import.meta.url).href,
  "reading": new URL("./doodles/reading.svg?no-inline", import.meta.url).href,
  "clumsy": new URL("./doodles/clumsy.svg?no-inline", import.meta.url).href,
  "plant": new URL("./doodles/plant.svg?no-inline", import.meta.url).href,
};

/** U4464: one named empty view; the owning surface supplies its next action. */
export const EmptyState = (props: { art: keyof typeof scenes; title: string; line: string; action?: JSX.Element; actions?: readonly { label: string; chip: string; run: () => void }[] | undefined; available?: boolean | undefined }) => {
  const title = createUniqueId();

  return <div class="empty-state" role="group" aria-labelledby={title}>
    <div class="empty-state-content">
    <div class="empty-state-art" aria-hidden="true"><svg viewBox="0 0 240 160"><use href={`${scenes[props.art]}#scene`} width="240" height="160" /></svg></div>
    <h3 id={title} class="empty-state-title">{props.title}</h3>
    <p class="empty-state-line">{props.line}</p>
    <Show when={props.actions?.length}><div class="empty-state-actions"><For each={props.actions}>{(action, index) => <button type="button" data-button={index() === 0 ? "primary" : "quiet"} aria-label={action.label} aria-disabled={props.available === false ? true : undefined} onClick={() => { if (props.available !== false) action.run(); }}>{action.label}<kbd class="empty-state-chip">{action.chip}</kbd></button>}</For></div></Show>
    <Show when={props.action}><div class="empty-state-actions">{props.action}</div></Show>
    </div>
  </div>;
};
