import type { ConnectedProject } from "../state/connectedProject";
import { doorStatus, doorTerminalId } from "../state/doorNode";

/** U7158: what a stray key reads off the centre. `data-live` while a Terminal runs for the selection; `data-waiting` while that Agent needs the user. */
export const centreState = (connected: ConnectedProject, node: Parameters<typeof doorStatus>[0]) => {
  const live = !!node && doorTerminalId(node) !== null && connected.rail.exitOf(node) === null && connected.daemonExit() === null;

  return {
    "data-live": live ? "" : undefined,
    "data-waiting": live && doorStatus(node)?.kind === "needs-you" ? "" : undefined,
  };
};
