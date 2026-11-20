import { createSignal, onCleanup } from "solid-js";
import type { ProgramRun } from "@contracts/project/ProgramRun";
import type { Events } from "../app/events";
import type { AppSeam } from "../app/seam";

/** PG3: where the Project's own program is, read again on each Terminal change. */
export type ProgramView = {
  run(): ProgramRun;
  refresh(): Promise<void>;
};

export const createProgram = (app: AppSeam, events: Events): ProgramView => {
  const [run, setRun] = createSignal<ProgramRun>({ state: "none" });

  const refresh = async () => {
    try {
      setRun(await app.rpc("project.programRun", null));
    } catch {
      // A Daemon without the method has no program to show; the next Event asks again.
    }
  };

  onCleanup(events.subscribe(event => { if (event.name === "terminal.changed") void refresh(); }));
  void refresh();

  return { run, refresh };
};
