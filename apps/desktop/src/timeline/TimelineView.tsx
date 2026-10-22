import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { Kind } from "@contracts/Kind";
import { copy } from "../copy";
import { DecisionCard } from "../decisions/DecisionCard";
import { glyphOf } from "../ink/glyph";
import { LABELS } from "../ink/KindGlyph";
import { descendantsOf } from "../rail/layout";
import { useConnectedProject } from "../state/connectedProject";
import { blocksOf, WINDOW_MS, withSample } from "./model";
import type { Block, Sample } from "./model";
import "./styles.css";

type Known = { name: string; parent: string | null; order: number; removed: boolean };

/** Reduced motion keeps the window still and leaves this much room past its last redraw for the open block to grow into. */
const HEADROOM_MS = 5 * 60_000;

const MINUTE_MS = 60_000;

const FIRST_CONTROL = ["textarea", "input", "button"].join(",");

/**
 * U3768a to U3768f: one lane per Agent of the Workstream `home` over the last 30 minutes.
 * It records the `agent.status` Events it hears and the Rail's current Statuses; an Agent's time before both is unknown.
 * One Event subscription and at most one display clock live here, and both end with the view.
 */
export const TimelineView = (props: { home: string; name: string; back: () => void; clock?: () => number }) => {
  const connected = useConnectedProject();
  const { rail, decisions, events } = connected;
  const clock = props.clock ?? Date.now;
  const [now, setNow] = createSignal(clock());
  const [anchor, setAnchor] = createSignal(clock());
  const [visible, setVisible] = createSignal(document.visibilityState !== "hidden");
  const [samples, setSamples] = createStore<Record<string, readonly Sample[]>>({});
  const [known, setKnown] = createStore<Record<string, Known>>({});
  const [asking, setAsking] = createSignal<string | null>(null);
  let card: HTMLElement | undefined;
  const blockOf = new Map<string, HTMLButtonElement>();

  const redraw = () => {
    const at = clock();

    setNow(at);
    setAnchor(at);
  };

  const remember = (id: string, sample: Sample) => {
    setSamples(id, (before) => withSample(before ?? [], sample));
  };

  // The Workstream's Agents on the Rail, Door included; one that leaves the Rail stays, named as removed.
  createEffect(() => {
    const below = descendantsOf(rail.nodes, props.home).filter((node) => node.kind === "agent");
    const door = rail.nodes.find((node) => node.id === props.home);
    const present = [...(door ? [door] : []), ...below];
    let changed = false;

    for (const node of present) {
      const before = known[node.id];

      if (!before || before.name !== node.name || before.parent !== node.parent || before.removed) setKnown(node.id, { name: node.name, parent: node.id === props.home ? null : node.parent, order: node.order, removed: false });

      if (node.status && node.attempt !== null && node.terminal_id !== null) {
        const sample = { at: node.status.since, attempt: node.attempt, kind: node.status.kind };

        if (!samples[node.id]?.some((each) => each.at === sample.at && each.attempt === sample.attempt && each.kind === sample.kind)) changed = true;
        remember(node.id, sample);
      }
    }

    for (const id of Object.keys(known)) if (!known[id]!.removed && !present.some((node) => node.id === id)) setKnown(id, "removed", true);

    if (changed) redraw();
  });

  const stop = events.subscribe((event) => {
    if (event.name !== "agent.status" || !known[event.data.id]) return;
    remember(event.data.id, { at: event.data.status.since, attempt: event.data.attempt, kind: event.data.status.kind });
    redraw();
  });

  const onVisibility = () => {
    const shown = document.visibilityState !== "hidden";

    setVisible(shown);

    if (shown) redraw();
  };

  document.addEventListener("visibilitychange", onVisibility);

  const reduced = () => connected.reducedMotion();
  const axisEnd = () => reduced() ? anchor() + HEADROOM_MS : now();
  const axisStart = () => axisEnd() - WINDOW_MS;
  const shownEnd = () => reduced() ? Math.min(Math.floor(now() / MINUTE_MS) * MINUTE_MS, axisEnd()) : now();

  type Lane = { id: string; name: string; removed: boolean; parent: string | null; blocks: (Block & { id: string })[] };

  const derived = createMemo((): Lane[] => {
    const children = (parent: string | null) => Object.entries(known).filter(([, each]) => each.parent === parent).toSorted((a, b) => (a[1].removed ? 1 : 0) - (b[1].removed ? 1 : 0) || a[1].order - b[1].order).map(([id]) => id);
    const walk = (id: string): string[] => [id, ...children(id).flatMap(walk)];
    const ids = known[props.home] ? walk(props.home) : [];

    return ids.flatMap((id) => {
      const blocks = blocksOf(samples[id] ?? [], 0).map((block) => ({ ...block, id: `${block.attempt}:${block.start}` }));

      return blocks.length === 0 ? [] : [{ id, name: known[id]!.name, removed: known[id]!.removed, parent: known[id]!.parent, blocks }];
    });
  });

  // Lanes and blocks keep their elements across redraws, so focus on a block survives a tick.
  const [shown, setShown] = createStore<{ lanes: Lane[] }>({ lanes: [] });

  createEffect(() => setShown("lanes", reconcile(derived(), { key: "id" })));
  const lanes = () => shown.lanes;
  const endOf = (block: Block) => block.open ? shownEnd() : block.end;
  const running = () => lanes().some((lane) => lane.blocks.some((block) => block.open && block.kind === "working"));

  // The display clock: one timer, only while a shown Agent works and the window is visible (U3768e).
  createEffect(() => {
    if (!visible() || !running() || connected.daemonExit() !== null) return;
    const timer = setInterval(() => setNow(clock()), 1000);

    onCleanup(() => clearInterval(timer));
  });

  createEffect(on(reduced, () => redraw(), { defer: true }));

  const percent = (at: number) => `${(Math.max(0, Math.min(1, (at - axisStart()) / WINDOW_MS)) * 100).toFixed(3)}%`;

  const lines = () => lanes().flatMap((child, at) => {
    const parent = lanes().findIndex((lane) => lane.id === child.parent);

    return parent < 0 ? [] : [{ from: parent, to: at, at: child.blocks[0]!.start, label: copy.timelineStarted(lanes()[parent]!.name, child.name) }];
  });

  const waiting = (id: string, block: { open: boolean; kind: Kind }) => block.open && block.kind === "needs-you" && decisions.of(id) !== undefined;

  const closeCard = () => {
    const id = asking();

    setAsking(null);

    if (id !== null) queueMicrotask(() => blockOf.get(id)?.focus());
  };

  // An answered Decision is no longer a button, so its card goes with it.
  createEffect(() => {
    const id = asking();

    if (id !== null && decisions.of(id) === undefined) setAsking(null);
  });

  onCleanup(() => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  });

  const toAgent = () => {
    const id = asking();

    if (id !== null) rail.select(id);
    props.back();
  };

  const openCard = (id: string) => {
    setAsking(id);
    queueMicrotask(() => (card?.querySelector<HTMLElement>(FIRST_CONTROL) ?? card)?.focus());
  };

  return <section class="timeline-view" ref={(element) => queueMicrotask(() => element.focus())} role="region" aria-label={copy.timeline} data-window-start={Math.round(axisStart())} data-window-end={Math.round(axisEnd())} data-running={running() ? "" : undefined} tabIndex={-1}
    onKeyDown={(event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.stopPropagation();

      if (asking() !== null) closeCard();
      else props.back();
    }}>
    <header class="timeline-header"><h2>{props.name}</h2><button data-button="quiet" type="button" onClick={props.back}>{copy.back}</button></header>
    <div class="timeline-axis"><span /><span class="timeline-axis-ends"><span>{copy.timelineStart}</span><span>{copy.timelineNow}</span></span></div>
    <Show when={lanes().length > 0} fallback={<p class="timeline-empty">{copy.timelineEmpty}</p>}>
      <div class="timeline-lanes">
        <ol aria-label={copy.timelineLanes}>
          <For each={lanes()}>{(lane) => <li class="timeline-lane" data-agent={lane.id}>
            <span class="timeline-name">{lane.removed ? copy.timelineRemoved(lane.name) : lane.name}</span>
            <div class="timeline-track" role="group" aria-label={copy.timelineTrack(lane.name)}>
              <Show when={lane.blocks[0]!.start > axisStart()}><span class="timeline-unknown" role="img" aria-label={copy.timelineUnknown} style={{ left: "0%", width: percent(lane.blocks[0]!.start) }} /></Show>
              <For each={lane.blocks}>{(block) => {
                const style = () => ({ left: percent(block.start), width: `calc(${percent(endOf(block))} - ${percent(block.start)})` });
                const label = () => LABELS[block.kind];

                return <Show when={waiting(lane.id, block)} fallback={<span class="timeline-block" role="img" aria-label={label()} data-kind={block.kind} data-tone={glyphOf(block.kind).tone} data-attempt={block.attempt} data-open={block.open ? "" : undefined} data-start={block.start} data-end={Math.round(endOf(block))} hidden={endOf(block) <= axisStart()} style={style()} />}>
                  <button class="timeline-block" type="button" ref={(element) => blockOf.set(lane.id, element)} aria-label={copy.decisionFor(lane.name)} aria-expanded={asking() === lane.id} data-kind={block.kind} data-tone={glyphOf(block.kind).tone} data-open="" data-start={block.start} data-end={Math.round(endOf(block))} hidden={endOf(block) <= axisStart()} style={style()} onClick={() => openCard(lane.id)} />
                </Show>;
              }}</For>
            </div>
          </li>}</For>
        </ol>
        <div class="timeline-lines">
          <For each={lines()}>{(line) => <span class="timeline-line" role="img" aria-label={line.label} style={{ left: percent(line.at), top: `calc(var(--lane-height) * ${line.from + 0.5})`, height: `calc(var(--lane-height) * ${line.to - line.from})` }} />}</For>
        </div>
      </div>
    </Show>
    <Show when={asking() !== null ? decisions.of(asking()!) : undefined}>{(decision) => <DecisionCard decision={decision()} name={known[asking()!]?.name ?? ""} focusTerminal={toAgent} ref={(element) => { card = element; }} onFocusIn={() => {}} onFocusOut={() => {}} />}</Show>
  </section>;
};
