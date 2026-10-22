import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect } from "vitest";
import type { Decision } from "@contracts/decision/Decision";
import { createProjectDrafts } from "../state/connectedProject";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import type { FakeApp } from "../testing/fakeApp";
import { agent, door, event } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";

afterEach(cleanup);

beforeEach(() => localStorage.clear());

export const decision = (id: string, agentId: string, over: Partial<Decision> = {}): Decision => ({
  id,
  agent: agentId,
  tool: "Bash",
  args: JSON.stringify({ command: "rm -rf build", description: "clean" }),
  opened_at: 1,
  answerable: true,
  ...over,
});

export const asking = (id: string, agentId: string, question: string, answers: string[]): Decision =>
  decision(id, agentId, { tool: "ask_user", args: JSON.stringify({ answers: answers.map((label) => ({ label, description: `about ${label}` })), question }) });

export type Asked = { label: string; description: string; preview?: string };

/** H14: an `ask_user` Decision whose answers carry a description and maybe a preview. */
export const askingWith = (id: string, agentId: string, question: string, answers: Asked[]): Decision =>
  decision(id, agentId, { tool: "ask_user", args: JSON.stringify({ answers, question }) });

export type Gate<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void };

export const gate = <T,>(): Gate<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { promise, resolve, reject };
};

export const opened = (value: Decision) => event({ name: "decision.opened", data: value });

export const cleared = (id: string, outcome: "allow" | "deny" | "replaced" | "agent-gone" | "terminal" | "answered" = "terminal") =>
  event({ name: "decision.cleared", data: { id, outcome } });

/** The real App over a fake Daemon holding agents alpha and beta and the Workstream "harbor" with a live Door. */
export const mountApp = async (listed: Decision[] | Promise<Decision[]> = [], prepare: (app: FakeApp) => void = () => {}, clock: () => number = () => 0) => {
  const app = createFakeApp();
  const emulators = fakeEmulators();

  app.opened.project = { name: "p", path: "/p" };
  app.handlers["rail.tree"] = () => [
    agent("a", "needs-you", "asks", { name: "alpha", order: 0 }),
    agent("b", "working", "editing", { name: "beta", order: 1 }),
    door("r", "needs-you", "asks", { name: "harbor", order: 2 }),
  ];
  app.handlers["terminal.list"] = () => [];
  app.handlers["terminal.write"] = () => null;
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  app.handlers["decision.list"] = () => listed;
  app.handlers["decision.answer"] = () => null;
  app.handlers["decision.capture"] = ({ id }) => ({ daemon: "daemon", agent: "a", attempt: "attempt-a", decision: id });
  prepare(app);

  const drafts = createProjectDrafts();

  const view = render(() => <App app={app} drafts={drafts} reducedMotion={() => false} clock={clock} createEmulator={emulators.factory} />);

  await waitFor(() => expect(view.container.querySelector(".pane")).not.toBeNull());
  await waitFor(() => expect(screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("data-id"))).toHaveLength(3));

  return { app, drafts, emulators, container: view.container };
};

export const select = (name: string) => {
  const row = screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("data-id")).find((each) => each.textContent?.includes(name));

  if (!row) throw new Error(`no row for ${name}`);

  fireEvent.click(row);
};

export const card = (): HTMLElement | null => document.querySelector<HTMLElement>(".decision-card");

export const rpcCalls = (app: FakeApp, method: string) => app.calls.filter((call) => call.method === method).map((call) => call.params);
