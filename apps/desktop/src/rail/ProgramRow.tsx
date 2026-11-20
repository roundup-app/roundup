import { Show, createEffect, createSignal } from "solid-js";
import { copy } from "./copy";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "../app/failureOf";
import { createMessageToast } from "../ink/messageToast";

type Method = "project.stopProgram" | "project.startProgram";

/** A refused or failed Stop or Start shows as a change failure, as the Settings section's own do. */
const createProgramAct = () => {
  const { app, program } = useConnectedProject();
  const [failure, setFailure] = createSignal<string | null>(null);

  createMessageToast({ get message() { return failure(); }, dismiss: () => setFailure(null) });

  return async (method: Method) => {
    setFailure(await failureOf(() => app.rpc(method, null)));
    await program.refresh();
  };
};

/** PG3: `Stop` on the program's own Terminal row while it runs. */
export const ProgramStop = (props: { id: string }) => {
  const { program } = useConnectedProject();

  const running = () => {
    const run = program.run();

    return run.state === "running" && run.terminalId === props.id;
  };

  return <Show when={running()}><ProgramStopButton /></Show>;
};

const ProgramStopButton = () => {
  const act = createProgramAct();

  return <button type="button" data-button="quiet" class="row-program-stop" aria-label={copy.programStopAria} onClick={() => void act("project.stopProgram")}>{copy.programStop}</button>;
};

/** PG3: while the program is down no Terminal row stands for it, so this row says why and offers `Start`. */
export const ProgramRow = () => {
  const { program } = useConnectedProject();
  const down = () => program.run().state === "stopped" || program.run().state === "restarting";

  return <Show when={down()}><ProgramDown /></Show>;
};

const ProgramDown = () => {
  const { program } = useConnectedProject();
  const act = createProgramAct();
  const [now, setNow] = createSignal(Date.now());

  // A 1 s countdown while the restart waits; the wall clock is read again when the state arrives.
  createEffect(() => program.run().state === "restarting", (waiting) => {
    if (!waiting) return;

    setNow(Date.now());

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  });

  const why = () => {
    const run = program.run();

    return run.state === "restarting" ? copy.programRestarting(Math.max(0, Math.ceil((run.restartAt - now()) / 1000))) : copy.programStopped;
  };

  return <div class="rail-program" role="group" aria-label={copy.program}>
    <span class="name">{copy.program}</span>
    <span class="light">{why()}</span>
    <button type="button" data-button="quiet" onClick={() => void act("project.startProgram")}>{copy.programStart}</button>
  </div>;
};
