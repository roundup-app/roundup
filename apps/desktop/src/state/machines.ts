import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import type { Machine } from "@contracts/machine/Machine";
import type { AppSeam, DaemonExit } from "../app/seam";

/** MC3, MC15: the Machines herdr-core lists, read on the App's coarse tick while an Agent runs on one. */
export const createMachines = (app: AppSeam, now: Accessor<number>, daemonExit: Accessor<DaemonExit | null>) => {
  const [list, setList] = createSignal<Machine[]>([]);
  const [start, setStart] = createSignal("");
  const [loaded, setLoaded] = createSignal(false);
  const online = () => list().filter(machine => machine.reachable !== false);

  return {
    /** MC74: whether any other Machine is reachable; an Agent on this Mac shows a chip only then. */
    any: () => online().length > 0,
    /** MC34, MC76: the online Machines the user may name for a start. */
    names: () => online().map(machine => machine.name),
    /** MC34: the Machine the user named for the start; empty leaves the pick to the Door. */
    start,
    nameStart: setStart,
    /** MC15, MC71: once the list is read, a named Machine that is unreachable or no longer on it; its Agents stay and show it. */
    offline: (name: string) => {
      const entry = list().find(machine => machine.name === name);

      return loaded() && (entry === undefined || entry.reachable === false);
    },
    /** Called once by the connected Project's rendered owner. */
    watch: (visible: Accessor<boolean>) => {
      createEffect(() => {
        now();

        if (!visible() || daemonExit()) return;

        let stale = false;

        onCleanup(() => { stale = true; });
        untrack(() => {
          void app.rpc("machine.list", null).then(machines => {
            if (stale) return;

            setList(machines);
            setLoaded(true);

            // MC76: a name the user chose goes when its Machine is removed or offline.
            if (!machines.some(machine => machine.name === start() && machine.reachable !== false)) setStart("");
          }, () => {});
        });
      });
    },
  };
};
