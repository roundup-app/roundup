import { render, screen, waitFor } from "@solidjs/testing-library";
import { expect } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { agent, info, workstream } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { projectMenu } from "../testing/menuProbe";
import type { ConnectedProject } from "../state/connectedProject";
import { todoHandlers } from "../testing/stores";
import { todo } from "../todos/testHarness";
import { WORKTREE } from "../changes/harness";

export const mountNavigation = async (empty = false, projectCount = 7) => {
  const app = createFakeApp();

  for (let n = 0; n < projectCount; n++) app.add(`/project${n}`);
  app.add("/p");
  const daemon = app.of("/p");
  const nodes = empty ? [] : [workstream("home"), ...Array.from({ length: 12 }, (_, index) => agent(`a${index}`, index === 0 ? "needs-you" : "idle", "ready", { name: `Agent ${index}`, parent: "home", worktree: WORKTREE }))];
  daemon.handlers["rail.tree"] = () => nodes;
  daemon.handlers["terminal.resize"] = () => null;
  daemon.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  const shells: ReturnType<typeof info>[] = [];
  daemon.handlers["terminal.list"] = () => [...shells, ...nodes.flatMap(node => node.terminal_id ? [info(node.terminal_id, { owner: node.id })] : [])];
  daemon.handlers["agent.changedFiles"] = () => ({ files: [{ path: "a.ts", status: "modified", line: 1 }] });
  daemon.handlers["agent.worktreeState"] = () => ({ ahead: 1, behind: 0, dirty: true });
  const store = { todos: [todo(1, { title: "Selected work", home: null })] };
  Object.assign(daemon.handlers, todoHandlers(store, () => {}));
  let connected: ConnectedProject | undefined;
  const emulators = fakeEmulators();
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={emulators.factory} prepareIdle={open => { connected = open; }} />);
  await screen.findByRole("textbox", { name: "Ask" });
  await waitFor(() => expect(projectMenu.path).toBe("/p"));

  return { app, daemon, connected: () => connected!, store, emulators, nodes, shells };
};
