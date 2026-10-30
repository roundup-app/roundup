import { copy as appCopy } from "./copy";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { Pane } from "../terminal/Pane";
import { RpcError } from "./seam";
import { createFakeApp } from "../testing/fakeApp";
import { info, node } from "../testing/nodes";

import { fakeEmulators } from "../terminal/paneHarness";

afterEach(cleanup);

it("u3791a_daemon_third_failure_is_visible", async () => {
  const app = createFakeApp();
  const name = "Retained work";
  const cause = "Cannot start Daemon";
  app.opened.project = { name: "project", path: "/p" };
  app.handlers["rail.tree"] = () => [node("retained", { name })];
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await screen.findByText(name);
  app.exitDaemon({ code: 1, recovery: "waiting" });
  expect(screen.queryByRole("button", { name: appCopy.reopen })).toBeNull();
  expect(screen.queryByText(new RegExp(appCopy.daemonExit("exited")))).toBeNull();
  expect(screen.getByText(name)).toBeTruthy();
  app.exitDaemon({ code: 1, recovery: "waiting", cause });
  expect(screen.queryByText(cause)).toBeNull();
  app.exitDaemon({ code: 1, cause });
  expect(screen.getAllByText(cause)).toHaveLength(1);
  expect(screen.getByRole("button", { name: appCopy.reopen })).toBeTruthy();
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


it("u3791a_read_recovers_once_without_intermediate_failure", async () => {
  const app = createFakeApp();
  let calls = 0;
  app.opened.project = { name: "project", path: "/p" };


  app.handlers["rail.tree"] = () => {
    if (++calls === 1) throw new TypeError("foreign read failed");

    return [node("kept", { name: "Recovered work" })];
  };

  const observer = vi.fn();
  const mutation = new MutationObserver(() => { if (document.querySelector('[role="alert"]')) observer(); });
  mutation.observe(document.body, { childList: true, subtree: true });
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await screen.findByText("Recovered work");
  mutation.disconnect();
  expect(calls).toBe(2);
  expect(observer).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(app.calls.filter(call => call.method === "agent.spawn" || call.method === "agent.prompt")).toEqual([]);
});

it("u3791a_second_failure_is_actionable", async () => {
  const app = createFakeApp();
  app.opened.project = { name: "project", path: "/p" };
  app.handlers["rail.tree"] = () => [node("kept", { name: "Last valid work" })];
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await screen.findByText("Last valid work");
  let calls = 0;
  app.handlers["rail.tree"] = () => { calls++; throw new Error(`read failure ${calls}`); };

  app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
  await screen.findByRole("alert");
  expect(calls).toBe(2);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.getByRole("treeitem", { name: /Last valid work/ })).toBeTruthy();


  app.handlers["rail.tree"] = () => {
    calls++;

    return [node("new", { name: "Acknowledged recovery" })];
  };

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Acknowledged recovery");
  expect(calls).toBe(3);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it("u3791a_retry_keeps_original_revision", async () => {
  const app = createFakeApp();
  const connected = await connectProject(app, { path: "/original", name: "original" }, () => true, () => 0);
  let reject!: (error: Error) => void;
  const targets: string[] = [];
  app.handlers["agent.compareFile"] = ({ path }) => {
    targets.push(path);

    if (targets.length === 1) return new Promise((_, no) => { reject = no; });
    throw new Error("second");
  };

  const params = { id: "original-agent", path: "original-file" };
  const pending = connected.app.rpc("agent.compareFile", params);
  const settled = expect(pending).rejects.toThrow("second");
  params.id = "replacement-agent";
  params.path = "replacement-file";
  app.opened.project = { path: "/other", name: "other" };
  reject(new Error("first"));
  await settled;
  expect(targets).toEqual(["original-file", "original-file"]);
  expect(app.calls.filter(call => call.method === "agent.compareFile").map(call => call.params)).toEqual([
    { id: "original-agent", path: "original-file" }, { id: "original-agent", path: "original-file" },
  ]);
});

it.each([new RpcError(-32002, "refused"), new RpcError(-32603, "internal"), new RpcError(-32004, "unknown"), new Error("disconnect")])("u3791a_remote_commands_are_not_replayed_%s", async error => {
  const app = createFakeApp();
  const connected = await connectProject(app, { path: "/p", name: "p" }, () => true, () => 0);
  app.handlers["message.send"] = () => { throw error; };

  await expect(connected.app.rpc("message.send", { to: "agent", kind: "note", body: " exact draft 😀\n ", replyTo: null })).rejects.toBe(error);
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1);
});


it("u3791a_project_read_exhaustion_keeps_explicit_retry", async () => {
  const app = createFakeApp();
  app.opened.project = { name: "project", path: "/p" };
  app.handlers["rail.tree"] = () => [node("kept", { name: "Recovered Project work" })];

  const list = vi.spyOn(app, "projects")
    .mockRejectedValueOnce(new TypeError("first"))
    .mockRejectedValueOnce(new Error("second"))
    .mockRejectedValueOnce(new Error("third"))
    .mockRejectedValueOnce(new Error("fourth"));

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await screen.findByRole("alert", { name: "second" });
  expect(list).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("alert", { name: "fourth" });
  expect(list).toHaveBeenCalledTimes(4);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("treeitem", { name: /Recovered Project work/ });
  expect(list).toHaveBeenCalledTimes(5);
  expect(screen.queryByRole("alert")).toBeNull();
});


it("u3791c_equal_causes_keep_recovery_with_their_owner", async () => {
  const app = createFakeApp();

  app.handlers["terminal.scheme"] = () => { throw new Error("same diagnostic"); };

  app.handlers["rail.tree"] = () => { throw new Error("same diagnostic"); };

  const connected = await connectProject(app, { name: "project", path: "/p" }, () => true, () => 0);

  render(() => <ConnectedProjectContext.Provider value={connected}>
    <Pane notice={connected.rail.failure()} retryNotice={() => void connected.rail.refresh({ terminals: true })} />
  </ConnectedProjectContext.Provider>);

  try {
    await screen.findByRole("alert");
    expect(app.calls.filter(call => call.method === "terminal.scheme")).toHaveLength(1);
    app.handlers["rail.tree"] = () => [node("kept", { name: "Recovered work" })];
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(connected.rail.failure()).toBeNull());
    expect(connected.rail.nodes.map(node => node.id)).toEqual(["kept"]);
    expect(app.calls.filter(call => call.method === "rail.tree")).toHaveLength(3);
    expect(app.calls.filter(call => call.method === "terminal.scheme")).toHaveLength(1);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    app.handlers["terminal.scheme"] = () => null;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(app.calls.filter(call => call.method === "terminal.scheme")).toHaveLength(2);
  } finally { connected.stopTerminalScheme(); }
});
