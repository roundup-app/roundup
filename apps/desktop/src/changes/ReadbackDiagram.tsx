import { createEffect, createSignal, createUniqueId, For, Show } from "solid-js";
import { failureOf } from "../app/failureOf";
import { loadLayout, type Layout, type LayoutGraph } from "../ui/graphLayout";
import { copy } from "./copy";
import { parseDiagram, partsOf, type Call, type Panel } from "./diagram";

const BOX = { height: 32, pad: 14, char: 7, label: { width: 0, height: 0 } };

const widthOf = (name: string) => name.length * BOX.char + 2 * BOX.pad;

/** U7688g: one layout library, loaded when the first diagram draws, shared with a Pad's statechart. */
let layout: Promise<LayoutGraph> | undefined;

type Laid = { layout: Layout; parts: readonly string[]; calls: readonly Call[] };

const lay = async (calls: readonly Call[]): Promise<Laid> => {
  const parts = partsOf(calls);
  const place = await (layout ??= loadLayout());

  return {
    parts,
    calls,
    layout: await place(parts.map(name => [name, { width: widthOf(name), height: BOX.height }]), calls.map(([from, to], at) => [String(at), from, to, BOX.label])),
  };
};

/** U7688c: the calls of one panel as boxes and arrows, drawn from the layout the library routes; the words under it say the same. */
const Figure = (props: { calls: readonly Call[] }) => {
  const [laid, setLaid] = createSignal<Laid>();
  const [failed, setFailed] = createSignal<string | null>(null);
  const arrow = createUniqueId();

  createEffect(() => props.calls, calls => {
    let current = true;

    void failureOf(async () => { const made = await lay(calls);

      if (current) setLaid(made); }).then(failure => { if (current) setFailed(failure); });

    return () => { current = false; };
  });

  return <>
    <Show when={failed()}>{cause => <p>{copy.diagramFailed} <span class="flow-cause">{cause()}</span></p>}</Show>
    <Show when={laid()}>{each => <svg class="readback-figure" aria-hidden="true" viewBox={`0 0 ${each().layout.width} ${each().layout.height}`} width={each().layout.width}>
      <defs><marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path class="readback-arrow" d="M0 0 L10 5 L0 10 z" /></marker></defs>
      <For each={each().calls}>{(_, at) => <polyline points={(each().layout.routes[String(at())] ?? []).map(point => `${point.x},${point.y}`).join(" ")} marker-end={`url(#${arrow})`} />}</For>
      <For each={each().parts}>{name => <g transform={`translate(${each().layout.boxes[name]?.x ?? 0} ${each().layout.boxes[name]?.y ?? 0})`}>
        <rect width={widthOf(name)} height={BOX.height} rx="6" />
        <text x={widthOf(name) / 2} y={BOX.height / 2} text-anchor="middle" dominant-baseline="central">{name}</text>
      </g>}</For>
    </svg>}</Show>
  </>;
};

const labelOf = (panel: Panel) => panel.label === "before" ? copy.diagramBefore : panel.label === "after" ? copy.diagramAfter : undefined;

/** U7688c: the account's diagram: a figure for each panel's calls, and always its words, a row for each call, which a pane too narrow for the figure shows alone. */
export const ReadbackDiagram = (props: { text: string }) => <figure class="readback-diagram" aria-label={copy.diagram}>
  <For each={parseDiagram(props.text)}>{panel => <div class="readback-panel">
    <Show when={labelOf(panel)}>{label => <p class="readback-panel-label">{label()}</p>}</Show>
    <Show when={panel.calls.length > 0}><Figure calls={panel.calls} /></Show>
    <ul class="readback-words">
      <For each={panel.calls}>{([from, to]) => <li>{copy.diagramCalls(from, to)}</li>}</For>
      <For each={panel.words}>{line => <li>{line}</li>}</For>
    </ul>
  </div>}</For>
</figure>;
