import { render, waitFor } from "@solidjs/testing-library";
import { afterAll } from "vitest";
import type { ChangedFiles } from "@contracts/agent/ChangedFiles";
import type { WorktreeState } from "@contracts/agent/WorktreeState";
import type { ConnectedProject } from "../state/connectedProject";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent, NOW } from "../testing/nodes";
import { WorktreeControl } from "./WorktreeControl";

// Opening the panel prefetches the reader and tree chunks without awaiting them. A file whose last test
// ends first would evaluate them after jsdom is gone ("window is not defined"), so each file awaits them.
afterAll(() => Promise.all([import("./DiffReader"), import("./ChangedTree")]));

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
export const mountControl = async (changed: () => ChangedFiles | Promise<ChangedFiles> = () => FILES, project = "/p", drafts?: ConnectedProject["drafts"]) => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => [agent("a", "working", "building", { worktree: WORKTREE }), agent("plain", "working", "building")];
  app.handlers["agent.worktreeState"] = () => STATE;
  let finished = false;
  app.handlers["agent.changedFiles"] = async () => { try { return await changed(); } finally { finished = true; } };

  const connected = await connectProject(app, { name: "p", path: project }, () => false, () => NOW, () => null, undefined, drafts);

  connected.rail.select("a");

  const view = render(() => {
    connected.worktrees.watch(() => true);

    return (
      <ConnectedProjectContext.Provider value={connected}>
        <WorktreeControl />
      </ConnectedProjectContext.Provider>
    );
  });

  await waitFor(() => { if (!finished) throw new Error(); });

  const calls = (method: string) => app.calls.filter((call) => call.method === method).length;

  return { app, connected, view, calls };
};
