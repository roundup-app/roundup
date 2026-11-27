import { render } from "@solidjs/testing-library";
import type { ChangedFiles } from "@contracts/agent/ChangedFiles";
import type { WorktreeState } from "@contracts/agent/WorktreeState";
import type { ConnectedProject } from "../state/connectedProject";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent, NOW } from "../testing/nodes";
import { ToastHost } from "../testing/toastHost";
import { type ChartView, noChart } from "./chart";
import { ChangesView } from "./ChangesView";
import { WorktreeControl } from "./WorktreeControl";

export const WORKTREE = { path: "/p/.roundup/a", branch: "roundup/a", base: "main", adopted: false };

export const STATE: WorktreeState = { ahead: 2, behind: 1, dirty: true };

const FILES: ChangedFiles = {
  files: [
    { path: "src/a.ts", status: "modified", line: 12, counts: null, blob: null },
    { path: "src/deep/b.ts", status: "added", line: 1, counts: null, blob: null },
    { path: "gone.ts", status: "deleted", line: null, counts: null, blob: null },
  ],
};

/** Mounts the bottom bar's Worktree control for selected Agent `a` (with a Worktree) and `plain` (without) over the fake App. */
export const mountControl = async (changed: () => ChangedFiles | Promise<ChangedFiles> = () => FILES, project = "/p", drafts?: ConnectedProject["drafts"], chart: ChartView = noChart) => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => [agent("a", "working", "building", { worktree: WORKTREE }), agent("plain", "working", "building")];
  app.handlers["agent.worktreeState"] = () => STATE;
  app.handlers["agent.changedFiles"] = () => changed();
  app.handlers["agent.ownedChanges"] = async () => ({ groups: [{ repo: WORKTREE.path, checkout: WORKTREE.path, branch: WORKTREE.branch, base: WORKTREE.base, files: (await changed()).files }] });

  const connected = await connectProject(app, { name: "p", path: project }, () => false, () => NOW, () => null, undefined, drafts);

  connected.rail.select("a");
  // The rail icon's `watch` starts this read in the App; no icon mounts here.
  void connected.owned.refresh("a");

  const view = render(() => {
    connected.worktrees.watch(() => true);

    return (
      <ToastHost>
        <ConnectedProjectContext value={connected}>
          <WorktreeControl />
          <ChangesView chart={chart} />
        </ConnectedProjectContext>
      </ToastHost>
    );
  });

  const calls = (method: string) => app.calls.filter((call) => call.method === method).length;

  return { app, connected, view, calls };
};
