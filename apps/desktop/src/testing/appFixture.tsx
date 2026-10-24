import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect } from "vitest";
import { createProjectDrafts } from "../state/connectedProject";
import { App } from "../App";
import { createFakeApp } from "./fakeApp";
import type { FakeApp } from "./fakeApp";
import { agent, door } from "./nodes";
import { fakeEmulators } from "../terminal/paneHarness";

afterEach(cleanup);

beforeEach(() => localStorage.clear());

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

/** The real App over a fake Daemon holding agents alpha and beta and the Workstream "harbor" with a live Door. */
export const mountApp = async (prepare: (app: FakeApp) => void = () => {}, clock: () => number = () => 0, reducedMotion = false) => {
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
  prepare(app);

  const drafts = createProjectDrafts();

  const view = render(() => <App app={app} drafts={drafts} reducedMotion={() => reducedMotion} clock={clock} createEmulator={emulators.factory} />);

  await waitFor(() => expect(view.container.querySelector(".pane")).not.toBeNull());
  await waitFor(() => expect(screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("data-id"))).toHaveLength(3));

  return { app, drafts, emulators, container: view.container };
};

export const select = (name: string) => {
  const row = screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("data-id")).find((each) => each.textContent?.includes(name));

  if (!row) throw new Error(`no row for ${name}`);

  fireEvent.click(row);
};

export const rpcCalls = (app: FakeApp, method: string) => app.calls.filter((call) => call.method === method).map((call) => call.params);
