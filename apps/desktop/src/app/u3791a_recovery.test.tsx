import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { node } from "../testing/nodes";

afterEach(cleanup);

it("u3791a_daemon_third_failure_is_visible", async () => {
  const app = createFakeApp();
  app.opened.project = { name: "project", path: "/p" };
  app.handlers["rail.tree"] = () => [node("retained", { name: "Retained work" })];
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await screen.findByText("Retained work");
  app.exitDaemon({ code: 1, recovery: "waiting" });
  expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  expect(screen.queryByText(/Daemon exited/)).toBeNull();
  expect(screen.getByText("Retained work")).toBeTruthy();
  app.exitDaemon({ code: 1, cause: "Cannot start Daemon" });
  expect(screen.getAllByText("Cannot start Daemon")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
});

it("u3791a_reconnected_project_refetches", async () => {
  const app = createFakeApp();
  app.opened.project = { name: "project", path: "/p" };
  app.handlers["rail.tree"] = () => [node("old", { name: "Old work" })];
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await screen.findByText("Old work");
  const reads = ["rail.tree", "terminal.list", "todo.list", "pad.list"];
  const before = reads.map(method => app.calls.filter(call => call.method === method).length);
  app.exitDaemon({ code: 1, recovery: "waiting" });
  app.handlers["rail.tree"] = () => [node("new", { name: "New work" })];
  app.exitDaemon({ code: 1, recovery: "connecting" });
  await screen.findByText("New work");
  await waitFor(() => reads.forEach((method, index) => expect(app.calls.filter(call => call.method === method).length).toBeGreaterThan(before[index]!)));
  expect(screen.queryByText("Old work")).toBeNull();
  expect(app.subscribed).toHaveLength(2);
  expect(app.calls.filter(call => /^(agent\.(spawn|stop|prompt)|terminal\.(write|resize)|message\.send)$/.test(call.method))).toEqual([]);
});
