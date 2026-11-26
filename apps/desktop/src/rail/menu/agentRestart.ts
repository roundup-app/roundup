import type { RailNode } from "@contracts/agent/RailNode";
import { isDoor } from "../../state/doorNode";
import type { AppSeam } from "../../app/seam";
import type { ExitState, RailState } from "../../state/rail";
import { railCommand } from "../railCommands";
import { copy } from "../copy";

/** U68: an Agent runs while its Terminal does, whatever its Kind; a Workstream keeps U56's Kind rule. */
export const isRunning = (node: RailNode, exit: ExitState | null) =>
  isDoor(node) && exit === null && (node.kind === "agent" ? true : node.status?.kind !== "done");

/** U2694d: `agent.resume {id, mode}` restarts the same session, running or exited; a failure shows U80's line (U7191c). An exited row is selected, and a reply lost after the send refreshes the row and shows the failure, with no second start while one is pending. The Rail's menu and a stopped Agent's pane bar (U7191i) share it. */
export const createAgentRestart = (app: AppSeam, rail: RailState, onFailure: (message: string, item?: string) => void) => {
  const resuming = new Set<string>();

  const restart = async (node: RailNode, mode: "normal" | "yolo"): Promise<void> => {
    const id = node.id;
    const exited = !isRunning(node, rail.exitOf(node));

    if (resuming.has(id)) return;

    resuming.add(id);

    if (exited) rail.select(id);

    try {
      await railCommand(rail, {
        item: id,
        // U5991a: the row shows running now; the refresh or a failure lifts the pending change.
        draw: () => {
          const release = rail.launch(id);
          const lift = exited ? rail.drawExit(id, null) : () => {};

          return () => { lift(); release(); };
        },
        call: () => app.rpc("agent.resume", { id, mode }),
        unknown: async () => {
          await rail.refresh({ terminals: true });

          if (rail.failure() !== null) onFailure(copy.resumeOutcomeUnknownTheDaemonMayHaveResumed, id);
        },
      });
    } finally { resuming.delete(id); }
  };

  return { restart };
};
