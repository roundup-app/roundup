import { render } from "@solidjs/testing-library";
import type { ChangedFiles } from "@contracts/agent/ChangedFiles";
import type { WorktreeState } from "@contracts/agent/WorktreeState";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent, NOW } from "../testing/nodes";
import { WorktreeControl } from "./WorktreeControl";

export const WORKTREE = { path: "/p/.roundup/a", branch: "roundup/a", base: "main" };

export const STATE: WorktreeState = { ahead: 2, behind: 1, dirty: true };

const FILES: ChangedFiles = {
  files: [
    { path: "src/a.ts", status: "modified", line: 12 },
    { path: "src/deep/b.ts", status: "added", line: 1 },
    { path: "gone.ts", status: "deleted", line: null },
  ],
};

/** Mounts the bottom bar's Worktree control for selected Agent `a` (with a Worktree) and `plain` (without) over the fake App. */
export const mountControl = async (changed: () => ChangedFiles | Promise<ChangedFiles> = () => FILES) => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => [agent("a", "working", "building", { worktree: WORKTREE }), agent("plain", "working", "building")];
  app.handlers["agent.worktreeState"] = () => STATE;
  app.handlers["agent.changedFiles"] = changed;

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => NOW);

  connected.rail.select("a");

  const view = render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <WorktreeControl />
    </ConnectedProjectContext.Provider>
  ));

  const calls = (method: string) => app.calls.filter((call) => call.method === method).length;

  return { app, connected, view, calls };
};
