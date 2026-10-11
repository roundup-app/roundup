import type { Pad } from "@contracts/pad/Pad";
import type { ConnectedProject } from "../state/connectedProject";

/** P13, U190: the Scribe of `pad`, from the Daemon's answer alone, so a reopened App or Project finds its exchange. */
export const scribeOf = (pad: Pad | undefined): string | null => pad?.scribe ?? null;

/** P13, U190 **Rail**: the ids of every Scribe the Daemon names for these Pads. */
export const scribeIds = (pads: readonly Pad[]): ReadonlySet<string> =>
  new Set(pads.flatMap((pad) => (pad.scribe === null ? [] : [pad.scribe])));

const pending = new Map<string, () => void>();

/** U190: an open Drawer for the Scribe `id` cancels the stop a closed one left waiting. */
export const keepScribe = (id: string): void => pending.get(id)?.();

/** U190: stops the Scribe `id` once it is idle, now or when it next goes idle; a Scribe that is gone or done needs no stop, and the next ask Resumes it. */
export const stopWhenIdle = (connected: ConnectedProject, id: string): void => {
  let finished = false;
  let unsubscribe: (() => void) | undefined;

  keepScribe(id);

  const finish = () => {
    finished = true;
    unsubscribe?.();

    if (pending.get(id) === finish) pending.delete(id);
  };

  pending.set(id, finish);

  const check = async () => {
    try {
      await connected.rail.settled();

      if (finished) return;

      const kind = connected.rail.nodes.find((node) => node.id === id)?.status?.kind;

      if (kind === "idle") {
        finish();
        await connected.app.rpc("agent.stop", { id });
      } else if (kind === undefined || kind === "done") finish();
    } catch {
      // A Daemon that stopped mid-check ends the wait; a Scribe it still holds is stopped when it next goes idle or the Daemon returns.
      finish();
    }
  };

  unsubscribe = connected.events.subscribe((event) => {
    if (event.name === "rail.changed" || (event.name === "agent.status" && event.data.id === id)) void check();
  });
  void check();
};
