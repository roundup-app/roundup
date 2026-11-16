import { createStore } from "solid-js/store";
import { railCommand } from "../railCommands";
import type { AppSeam } from "../../app/seam";
import type { RailState } from "../../state/rail";

/** The saved-prompt restart of a Mode (`agent.restartMode`): one request id per Mode until the Daemon acknowledges it. */
export const createModeRestart = (app: AppSeam, rail: RailState) => {
  const [restarts, setRestarts] = createStore<Record<string, { request: string; pending: boolean } | undefined>>({});

  const restartMode = async (id: string, request = restarts[id]?.request ?? crypto.randomUUID()): Promise<{ kind: "acknowledged" | "pending" } | { kind: "failed" | "unknown"; message: string }> => {
    if (restarts[id]?.pending) return { kind: "pending" };
    setRestarts(id, { request, pending: true });

    try {
      const outcome = await railCommand(rail, {
        item: id,
        draw: () => rail.launch(id),
        call: () => app.rpc("agent.restartMode", { id, request }),
        terminals: true,
        retry: () => { void restartMode(id); },
      });

      if (outcome.kind === "applied") {
        setRestarts(id, undefined);

        return { kind: "acknowledged" };
      }

      return { kind: outcome.kind === "refused" ? "failed" : "unknown", message: outcome.error.message };
    } finally {
      if (restarts[id]) setRestarts(id, { request, pending: false });
    }
  };

  return { restartMode, restartPending: (id: string) => restarts[id]?.pending ?? false };
};
