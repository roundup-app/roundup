import { openPrinted } from "./links";
import type { Printed } from "./links";
import type { ConnectedProject } from "../state/connectedProject";
import type { Failures } from "./failures";

/** `openObject` is the App's one route for a `roundup://` link (AL3); without it the link goes to the OS like any other address. */
export const createOpener = (connected: ConnectedProject, failures: Failures, openObject?: (url: string, surface: string) => void) => {
  const { app, rail, project } = connected;

  /** U365: a Door's Terminal and a worktree-less Agent's resolve against the Project folder; an Agent's against its Worktree. */
  return async (id: string, printed: Printed): Promise<void> => {
    if (printed.kind === "url" && openObject && !/^https?:/i.test(printed.url)) {
      failures.set(id, "link", null);
      openObject(printed.url, project.path);

      return;
    }

    const node = rail.nodes.find((candidate) => candidate.terminal_id === id);
    const worktree = node?.kind === "agent" ? node.worktree?.path : undefined;
    const failure = await openPrinted((target) => app.openTarget(target), printed, [worktree ?? project.path, project.path, ...worktree ? [worktree] : []]);

    failures.set(id, "link", failure);
  };
};
