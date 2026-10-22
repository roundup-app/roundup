import { createEffect, createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { Events } from "../app/events";
import type { RailState } from "../state/rail";
import { withSample } from "./model";
import type { Sample } from "./model";

export type Known = { name: string; parent: string | null; order: number; removed: boolean };

/** Samples kept per Agent; the Daemon's own window is 10 000 Events across all kinds. */
const PER_AGENT = 500;

export type TimelineLog = {
  samples: Record<string, readonly Sample[]>;
  known: Record<string, Known>;
  /** Counts every change, so a view redraws when one lands. */
  version: () => number;
  stop: () => void;
};

/**
 * U3768a to U3768c: what the App has heard of each Agent's Statuses, the Daemon's saved Events from before it connected included, kept for the Project's life
 * so a timeline opened later still shows what happened before it opened. An Agent that leaves the Rail stays, named as removed.
 * The Rail's current Statuses seed the rest; an Agent's time before both is unknown.
 */
export const createTimelineLog = (events: Events, rail: RailState): TimelineLog => {
  const [samples, setSamples] = createStore<Record<string, readonly Sample[]>>({});
  const [known, setKnown] = createStore<Record<string, Known>>({});
  const [version, setVersion] = createSignal(0);

  const remember = (id: string, sample: Sample) => {
    if (samples[id]?.some((each) => each.at === sample.at && each.attempt === sample.attempt && each.kind === sample.kind)) return;
    setSamples(id, (before) => withSample(before ?? [], sample).toSorted((a, b) => a.at - b.at).slice(-PER_AGENT));
    setVersion((each) => each + 1);
  };

  const dispose = createRoot((end) => {
    createEffect(() => {
      const present = new Set<string>();

      for (const node of rail.nodes) {
        present.add(node.id);
        const before = known[node.id];

        if (!before || before.name !== node.name || before.parent !== node.parent || before.order !== node.order || before.removed) setKnown(node.id, { name: node.name, parent: node.parent, order: node.order, removed: false });

        if (node.status && node.attempt !== null && node.terminal_id !== null) remember(node.id, { at: node.status.since, attempt: node.attempt, kind: node.status.kind });
      }

      for (const id of Object.keys(known)) if (!known[id]!.removed && !present.has(id)) setKnown(id, "removed", true);

      setVersion((each) => each + 1);
    });

    return end;
  });

  // The saved Events replay first (D11), then the live ones; `remember` drops a Status it already holds.
  const unsubscribe = events.subscribe((event) => {
    if (event.name === "agent.status") remember(event.data.id, { at: event.data.status.since, attempt: event.data.attempt, kind: event.data.status.kind });
  }, { replay: true });

  return { samples, known, version, stop: () => { unsubscribe(); dispose(); } };
};
