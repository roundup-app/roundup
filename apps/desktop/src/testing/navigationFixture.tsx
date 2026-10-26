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

export const key = (code: string, options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { code, key: code === "Enter" ? "Enter" : code.replace("Key", "").toLowerCase(), bubbles: true, cancelable: true, ...options });
  (document.activeElement ?? document.body).dispatchEvent(event);
};

export const leader = (code: string) => { key("KeyK", { metaKey: true }); key(code); };

export const mount = async (empty = false) => {
  const app = createFakeApp();

  for (let n = 0; n < 7; n++) app.add(`/project${n}`);
  app.add("/p");
  const daemon = app.of("/p");
  const nodes = empty ? [] : [workstream("home"), ...Array.from({ length: 12 }, (_, index) => agent(`a${index}`, index === 0 ? "needs-you" : "idle", "ready", { name: `Agent ${index}`, parent: "home", worktree: WORKTREE }))];
  daemon.handlers["rail.tree"] = () => nodes;
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

