import { createSignal } from "solid-js";
import type { ConnectedProject } from "../state/connectedProject";

type Known = { pads: Map<string, string>; ids: () => ReadonlySet<string>; add: (id: string) => void };

const known = new WeakMap<ConnectedProject, Known>();

const knownOf = (connected: ConnectedProject): Known => {
  const existing = known.get(connected);

  if (existing !== undefined) return existing;

  const [ids, setIds] = createSignal<ReadonlySet<string>>(new Set());
  const made: Known = { pads: new Map(), ids, add: (id) => setIds((all) => new Set([...all, id])) };

  known.set(connected, made);

  return made;
};

/** U190: the Scribe `pad.ask` named for `pad` in this Project's session, so a reopened Drawer finds its exchange. */
export const scribeOf = (connected: ConnectedProject, pad: string): string | null => knownOf(connected).pads.get(pad) ?? null;

/** U190 **Rail**: the ids of every Scribe this session started; reactive. */
export const scribeIds = (connected: ConnectedProject): ReadonlySet<string> => knownOf(connected).ids();

export const rememberScribe = (connected: ConnectedProject, pad: string, agent: string): void => {
  const entry = knownOf(connected);

  entry.pads.set(pad, agent);
  entry.add(agent);
};
