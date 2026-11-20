import { Show } from "solid-js";
import { copy } from "./copy";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "../app/failureOf";

/** PG3: the Project program's state, with `Stop` while it runs and `Start` while it is stopped or waiting to restart. */
export const ProgramRow = () => {
  const { app, program, now } = useConnectedProject();

  const act = async (method: "project.stopProgram" | "project.startProgram") => {
    await failureOf(() => app.rpc(method, null));
    await program.refresh();
  };

  const why = () => {
    const run = program.run();

    return run.state === "stopped" ? copy.programStopped : run.state === "restarting" ? copy.programRestarting(Math.max(0, Math.ceil((run.restartAt - now()) / 1000))) : null;
  };

  return <Show when={program.run().state !== "none"}>
    <div class="rail-program" role="group" aria-label={copy.program}>
      <span class="name">{copy.program}</span>
      <Show when={why()}>{text => <span class="light">{text()}</span>}</Show>
      <Show when={program.run().state === "running"} fallback={<button type="button" data-button="quiet" onClick={() => void act("project.startProgram")}>{copy.programStart}</button>}>
        <button type="button" data-button="quiet" onClick={() => void act("project.stopProgram")}>{copy.programStop}</button>
      </Show>
    </div>
  </Show>;
};
