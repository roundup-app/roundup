import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { info, node } from "../testing/nodes";

import { fakeEmulators } from "../terminal/paneHarness";

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
  app.exitDaemon({ code: 1, recovery: "waiting", cause: "Cannot start Daemon" });
  expect(screen.queryByText("Cannot start Daemon")).toBeNull();
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
  const input = screen.getByRole("textbox", { name: "Ask" });
  fireEvent.input(input, { target: { value: "Exact draft  🌿\nnext line  " } });
  const reads = ["rail.tree", "terminal.list", "todo.list", "pad.list"];
  const before = reads.map(method => app.calls.filter(call => call.method === method).length);
  app.exitDaemon({ code: 1, recovery: "waiting" });
  app.handlers["rail.tree"] = () => [node("new", { name: "New work" })];
  app.exitDaemon({ code: 1, recovery: "connecting" });
  await screen.findByText("New work");
  await waitFor(() => reads.forEach((method, index) => expect(app.calls.filter(call => call.method === method).length).toBeGreaterThan(before[index]!)));
  expect(screen.queryByText("Old work")).toBeNull();
  expect(app.subscribed).toHaveLength(2);
  expect(screen.getByRole("textbox", { name: "Ask" })).toHaveProperty("value", "Exact draft  🌿\nnext line  ");
  expect(app.calls.filter(call => /^(agent\.(spawn|stop|prompt)|terminal\.(write|resize)|message\.send)$/.test(call.method))).toEqual([]);
});

it("u3791a_recovery_sends_no_agent_input", async () => {
  const app = createFakeApp();
  const { factory, made } = fakeEmulators();
  app.opened.project = { name: "project", path: "/p" };
  app.handlers["rail.tree"] = () => [node("old", { name: "Original Agent" })];
  app.handlers["terminal.list"] = () => [info("t-old")];
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  app.handlers["terminal.resize"] = () => null;
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={factory} />);
  fireEvent.click(await screen.findByText("Original Agent"));
  await waitFor(() => expect(made.get("t-old")?.host).toBeTruthy());
  await waitFor(() => expect(app.outputSubscriptions.some(subscription => subscription.id === "t-old")).toBe(true));
  app.calls.length = 0;
  app.exitDaemon({ code: 1, recovery: "waiting" });
  made.get("t-old")!.type(Uint8Array.of(120));
  window.dispatchEvent(new Event("resize"));
  await new Promise(resolve => requestAnimationFrame(resolve));
  app.handlers["rail.tree"] = () => [];
  app.handlers["terminal.list"] = () => [];
  app.exitDaemon({ code: 1, recovery: "connecting" });
  await waitFor(() => expect(screen.queryByText("Original Agent")).toBeNull());
  expect(app.calls.filter(call => /^(agent\.(spawn|stop|prompt)|terminal\.(write|resize)|message\.send)$/.test(call.method))).toEqual([]);
});
