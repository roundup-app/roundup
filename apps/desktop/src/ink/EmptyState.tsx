import { createUniqueId, For, Show, type JSX } from "solid-js";
import strolling from "./doodles/strolling.svg?no-inline";
import running from "./doodles/running.svg?no-inline";
import reading_side from "./doodles/reading-side.svg?no-inline";
import laying from "./doodles/laying.svg?no-inline";
import unboxing from "./doodles/unboxing.svg?no-inline";
import meditating from "./doodles/meditating.svg?no-inline";
import sitting_reading from "./doodles/sitting-reading.svg?no-inline";
import loving from "./doodles/loving.svg?no-inline";
import reading from "./doodles/reading.svg?no-inline";
import clumsy from "./doodles/clumsy.svg?no-inline";
import plant from "./doodles/plant.svg?no-inline";

const scenes = { strolling, running, "reading-side": reading_side, laying, unboxing, meditating, "sitting-reading": sitting_reading, loving, reading, clumsy, plant };

/** U4464: one named empty view; the owning surface supplies its next action. */
export const EmptyState = (props: { art: keyof typeof scenes; title: string; line: string; action?: JSX.Element; chip?: string | undefined; actions?: readonly { label: string; chip: string; run: () => void }[] | undefined; available?: boolean | undefined }) => {
  const title = createUniqueId();

  return <div class="empty-state" role="group" aria-labelledby={title}>
    <div class="empty-state-art" aria-hidden="true"><svg viewBox="0 0 240 160"><use href={`${scenes[props.art]}#scene`} width="240" height="160" /></svg></div>
    <h3 id={title} class="empty-state-title">{props.title}</h3>
    <p class="empty-state-line">{props.line}</p>
    <Show when={props.actions}><div class="empty-state-actions"><For each={props.actions}>{action => <div class="empty-state-start"><button type="button" data-button="primary" aria-disabled={props.available === false ? true : undefined} onClick={() => { if (props.available !== false) action.run(); }}>{action.label}</button><kbd class="empty-state-chip">{action.chip}</kbd></div>}</For></div></Show>
    <Show when={props.action}>{props.action}</Show>
    <Show when={props.chip}>{chip => <kbd class="empty-state-chip">{chip()}</kbd>}</Show>
  </div>;
};
