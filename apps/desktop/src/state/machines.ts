import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import type { Machine } from "@contracts/machine/Machine";
import type { AppSeam, DaemonExit } from "../app/seam";

/** MC3, MC15: the Machines herdr-core lists, read on the App's coarse tick while an Agent runs on one. */
export const createMachines = (app: AppSeam, now: Accessor<number>, daemonExit: Accessor<DaemonExit | null>) => {
  const [list, setList] = createSignal<Machine[]>([]);
  const [start, setStart] = createSignal("");

  return {
    /** Whether any other Machine exists; an Agent on this Mac shows a chip only then. */
    any: () => list().length > 0,
    /** MC34: the Machines the user may name for a start. */
    names: () => list().map(machine => machine.name),
    /** MC34: the Machine the user named for the start; empty leaves the pick to the Door. */
    start,
    nameStart: setStart,
    /** MC15: false only once roundup's ssh to the named Machine has failed to answer. */
    offline: (name: string) => list().find(machine => machine.name === name)?.reachable === false,
    /** Called once by the connected Project's rendered owner. */
    watch: (visible: Accessor<boolean>) => {
      createEffect(() => {
        now();

        if (!visible() || daemonExit()) return;

        let stale = false;

        onCleanup(() => { stale = true; });
        untrack(() => { void app.rpc("machine.list", null).then(machines => { if (!stale) setList(machines); }, () => {}); });
      });
    },
  };
};
