import { copy } from "./copy";
import type { RailNode } from "@contracts/agent/RailNode";
import { exitText } from "../ink/exitText";
import type { ExitState } from "../state/rail";

/** Why a Workstream's Door has no running program. `stopped` means launched before and not running now, however it ended. */
export type DoorState =
  | { kind: "starting" }
  | { kind: "failed" }
  | { kind: "never-started" }
  | { kind: "stopped"; exit: ExitState };

/** `null` while the Door's program runs; `exit` is `rail.exitOf` for the Workstream, `pending` and `failed` are the Rail's record of a `rail.startDoor` call. */
export const doorStateOf = (workstream: RailNode, exit: ExitState | null, pending: boolean, failed: boolean): DoorState | null => {
  if (exit === null) return null;

  if (pending) return { kind: "starting" };

  if (failed) return { kind: "failed" };

  return workstream.attempt === null ? { kind: "never-started" } : { kind: "stopped", exit };
};

export const doorStateText = (state: DoorState, name: string): string => {
  switch (state.kind) {
    case "starting":
      return copy.startingDoor(name);
    case "failed":
      return copy.doorDidNotStart;
    case "never-started":
      return copy.doorNotStarted;
    case "stopped":
      return state.exit.kind === "unknown" ? copy.doorStopped(name) : copy.doorStoppedWithExit(name, exitText(state.exit));
  }
};
