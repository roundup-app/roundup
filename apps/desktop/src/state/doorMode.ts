import { createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import { doorStateOf } from "../rail/doorState";
import type { ConnectedProject } from "./connectedProject";

/**
 * U187: how the centre talks to the selected Workstream's Door.
 * `thread`: the feed above the composer, the Door's Terminal not shown; `takeover`: the Terminal, typing goes straight to the Door;
 * `agent`: an Agent below the Door is selected, so its Terminal shows above the composer; `none`: no Workstream.
 */
export type DoorMode = {
  mode: Accessor<"none" | "thread" | "takeover" | "agent">;
  /** The selected Workstream's id, or the one above the selected row; `null` when none. */
  door: Accessor<string | null>;
  /** Whether the Door's program runs, so there is something to take over. */
  running: Accessor<boolean>;
};

export const createDoorMode = ({ rail, takeover }: Pick<ConnectedProject, "rail" | "takeover">): DoorMode => {
  const door = createMemo(() => {
    let id = rail.selected();

    while (id !== null) {
      const found = rail.nodes.find((node) => node.id === id);

      if (found === undefined) return null;

      if (found.kind === "workstream") return found.id;

      id = found.parent;
    }

    return null;
  });

  const mode = createMemo<"none" | "thread" | "takeover" | "agent">(() => {
    const id = door();

    if (id === null) return "none";

    if (rail.selected() !== id) return "agent";

    return takeover.taken() === id ? "takeover" : "thread";
  });

  const running = createMemo(() => {
    const workstream = rail.nodes.find((node) => node.id === door());

    return workstream !== undefined && doorStateOf(workstream, rail.exitOf(workstream), rail.doorPending(workstream.id), rail.doorFailure(workstream.id) !== null) === null;
  });

  return { mode, door, running };
};
