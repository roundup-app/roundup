import type { ConnectedProject } from "../state/connectedProject";

const known = new WeakMap<ConnectedProject, Map<string, string>>();

/** U190: the Scribe `pad.ask` named for `pad` in this Project's session, so a reopened Drawer finds its exchange. */
export const scribeOf = (connected: ConnectedProject, pad: string): string | null => known.get(connected)?.get(pad) ?? null;

export const rememberScribe = (connected: ConnectedProject, pad: string, agent: string): void => {
  known.set(connected, (known.get(connected) ?? new Map()).set(pad, agent));
};
