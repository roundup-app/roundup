import { createStore } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import { hasConversation } from "../../state/doorNode";
import { railCommand } from "../railCommands";
import type { AppSeam } from "../../app/seam";
import type { ExitState, RailState } from "../../state/rail";

/** A Mode's Restart. A saved conversation resumes through `resume` (U7191a); else the saved-prompt restart (`agent.restartMode`) runs, with one request id per Mode until the Daemon acknowledges it. */
export const createModeRestart = (app: AppSeam, rail: RailState, resume: (node: RailNode, exit: ExitState | null) => void) => {
  const [restarts, setRestarts] = createStore<Record<string, { request: string; pending: boolean } | undefined>>({});

  const restartMode = async (id: string, request = restarts[id]?.request ?? crypto.randomUUID()): Promise<{ kind: "acknowledged" | "pending" } | { kind: "failed" | "unknown"; message: string }> => {
    let claimed = false;
    setRestarts(entries => { if (!entries[id]?.pending) { entries[id] = { request, pending: true }; claimed = true; } });

    if (!claimed) return { kind: "pending" };

    try {
      const outcome = await railCommand(rail, {
        item: id,
        draw: () => rail.launch(id),
        call: () => app.rpc("agent.restartMode", { id, request }),
        terminals: true,
        retry: () => { void restartMode(id); },
      });

      if (outcome.kind === "applied") {
        setRestarts(entries => { delete entries[id]; });

        return { kind: "acknowledged" };
      }

      return { kind: outcome.kind === "refused" ? "failed" : "unknown", message: outcome.error.message };
    } finally {
      setRestarts(entries => { if (entries[id]) entries[id] = { request, pending: false }; });
    }
  };

  /** U7191a: the row's icon, its `R` key and its menu run this one action. */
  const restartRow = (id: string) => {
    const node = rail.nodes.find(candidate => candidate.id === id);

    if (node && hasConversation(node)) resume(node, rail.exitOf(node));
    else void restartMode(id);
  };

  return { restartMode, restartRow, restartPending: (id: string) => restarts[id]?.pending ?? false };
};
