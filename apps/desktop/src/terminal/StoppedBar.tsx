import { Show, createMemo } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import { BusyButton } from "../ui/BusyButton";
import { Tip } from "../ui/Tip";
import { CopyButton } from "../ui/CopyButton";
import { clipboardFailure } from "../app/clipboard";
import { createAgentRestart } from "../rail/menu/agentRestart";
import { createModeRestart } from "../rail/menu/modeRestart";
import { railCommand } from "../rail/railCommands";
import { isMode } from "../rail/layout";
import { isYolo } from "../state/doorNode";
import { useConnectedProject } from "../state/connectedProject";
import { copy } from "./copy";

/** U7191i: a stopped Agent's saved conversation id, with Copy, Fork and Restart, in the Pane's top inset. */
export const StoppedBar = (props: { selected: () => RailNode | null }) => {
  const { rail } = useConnectedProject();

  /** A stopped Agent whose saved conversation the Daemon names. */
  const stopped = createMemo(() => {
    const node = props.selected();
    const id = node?.kind === "agent" ? node.overview?.id : undefined;

    return node && id !== undefined && rail.exitOf(node) !== null ? { node, id } : null;
  });

  return <Show when={stopped()}>{(held) => <Bar node={held().node} id={held().id} />}</Show>;
};

const Bar = (props: { node: RailNode; id: string }) => {
  const { app, rail } = useConnectedProject();
  const failed = (message: string, item?: string) => { rail.commandFailure.show(message, item ?? null, "pane"); };

  const { restart } = createAgentRestart(app, rail, failed);
  const mode = createModeRestart(app, rail, () => {});

  /** One `agent.offshoot`; the new row, placed after this one, is selected once the Daemon answers. */
  const fork = async () => {
    const outcome = await railCommand(rail, { item: props.node.id, call: () => app.rpc("agent.offshoot", { id: props.node.id }), terminals: true });

    if (outcome.kind === "applied") rail.select(outcome.value.id);
  };

  const again = async () => {
    if (isMode(props.node)) await mode.restartMode(props.node.id);
    else await restart(props.node, isYolo(props.node) ? "yolo" : "normal");
  };

  return (
    <div class="stopped-bar" role="group" aria-label={copy.conversationId(props.id)}>
      <Tip kind="changing" text={props.id}>
        {(trigger) => <span {...trigger()} class="stopped-bar-id" tabindex={0}>{copy.conversationId(props.id)}</span>}
      </Tip>
      <CopyButton data-button="quiet" app={app} text={props.id} identity={props.node.id} onFailure={error => { failed(clipboardFailure("copy", error), props.node.id); }}>{copy.copy}</CopyButton>
      <BusyButton kind="quiet" busyLabel={copy.forking} onClick={fork}>{copy.fork}</BusyButton>
      <BusyButton kind="quiet" busyLabel={copy.restarting} onClick={again}>{copy.restart}</BusyButton>
    </div>
  );
};
