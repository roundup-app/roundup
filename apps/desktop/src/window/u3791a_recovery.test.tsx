import { copy as windowCopy } from "./copy";
import { copy as appCopy } from "../app/copy";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { Pane } from "../terminal/Pane";
import { RpcError } from "../app/seam";
import { createFakeApp } from "../testing/fakeApp";
import { info, node } from "../testing/nodes";

import { fakeEmulators } from "../terminal/paneHarness";
import { useRealBackoff } from "../testing/immediateRetry";

afterEach(cleanup);

useRealBackoff();

it("u3791a_daemon_third_failure_is_visible", async () => {
  const app = createFakeApp();
  const retained = node("retained", { name: "Retained work" });
  const failure = new Error("Cannot start Daemon");
  app.opened.project = { name: "project", path: "/p" };
  app.handlers["rail.tree"] = () => [retained];
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await screen.findByText(retained.name);
  app.exitDaemon({ code: 1, recovery: "waiting" });
  expect(screen.queryByRole("button", { name: windowCopy.reopen })).toBeNull();
  expect(screen.queryByText(new RegExp(appCopy.daemonExit("exited")))).toBeNull();
  screen.getByText(retained.name);
  app.exitDaemon({ code: 1, recovery: "waiting", cause: failure.message });
  expect(screen.queryByText(failure.message)).toBeNull();
  app.exitDaemon({ code: 1, cause: failure.message });
  expect(screen.getAllByText(failure.message)).toHaveLength(1);
  screen.getByRole("button", { name: windowCopy.reopen });
});

it("u3791a_reconnected_project_refetches", async () => {
  const app = createFakeApp();
  app.opened.project = { name: "project", path: "/p" };
  app.handlers["rail.tree"] = () => [node("old", { name: "Old work" })];
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await screen.findByText("Old work");
  fireEvent.keyDown(document.body, { key: "/", code: "Slash", metaKey: true });
  const input = await screen.findByRole("textbox", { name: "Ask" });
  fireEvent.input(input, { target: { value: "Exact draft  🌿\nnext line  " } });
  const reads = ["rail.tree", "terminal.list", "todo.list", "pad.list"];
  const before = reads.map(method => app.calls.filter(call => call.method === method).length);
  app.exitDaemon({ code: 1, recovery: "waiting" });
  app.handlers["rail.tree"] = () => [node("new", { name: "New work" })];
  app.exitDaemon({ code: 1, recovery: "connecting" });
  await screen.findByText("New work");
  await waitFor(() => reads.forEach((method, index) => expect(app.calls.filter(call => call.method === method).length).toBeGreaterThan(before[index]!)));
  expect(document.querySelector('.rail-row[data-id="old"]')).toBeNull();
  expect(app.subscribed).toHaveLength(2);

  if (!screen.queryByRole("textbox", { name: "Ask" })) fireEvent.keyDown(document.body, { key: "/", code: "Slash", metaKey: true });
  expect(await screen.findByRole("textbox", { name: "Ask" })).toHaveProperty("value", "Exact draft  🌿\nnext line  ");
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


/** The longest the four randomised waits (250 ms doubling, at most twice each, capped at 4 s) can add up to. */
const BACKOFF = 4 * 4000;

afterEach(() => { vi.useRealTimers(); });

it("u6249b_reads_retry_with_backoff_before_failing", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const app = createFakeApp();
  app.opened.project = { name: "project", path: "/p" };
  let calls = 0;

  app.handlers["rail.tree"] = () => {
    if (++calls <= 3) throw new TypeError("foreign read failed");

    return [node("kept", { name: "Recovered work" })];
  };

  const alerts = vi.fn();
  const mutation = new MutationObserver(() => { if (document.querySelector('[role="alert"]')) alerts(); });
  mutation.observe(document.body, { childList: true, subtree: true });
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await vi.advanceTimersByTimeAsync(BACKOFF);
  mutation.disconnect();
  screen.getByText("Recovered work");
  expect(calls).toBe(4);
  expect(alerts).not.toHaveBeenCalled();
  cleanup();

  calls = 0;
  app.handlers["rail.tree"] = () => { calls++; throw new Error(`read failure ${calls}`); };

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await vi.advanceTimersByTimeAsync(250 - 1);
  expect(screen.queryByRole("alert")).toBeNull();
  await vi.advanceTimersByTimeAsync(BACKOFF);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(calls).toBe(5);

  const send = vi.fn(() => { throw new RpcError(-32002, "refused"); });
  app.handlers["message.send"] = send;
  app.handlers["rail.tree"] = () => [];
  const connected = await connectProject(app, { path: "/p", name: "p" }, () => true, () => 0);
  await expect(connected.app.rpc("message.send", { to: "agent", kind: "note", body: "x", replyTo: null })).rejects.toThrow("refused");
  expect(send).toHaveBeenCalledTimes(1);
});

it("u3791a_second_failure_is_actionable", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const app = createFakeApp();
  app.opened.project = { name: "project", path: "/p" };
  app.handlers["rail.tree"] = () => [node("kept", { name: "Last valid work" })];
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await vi.advanceTimersByTimeAsync(0);
  screen.getByText("Last valid work");
  let calls = 0;
  app.handlers["rail.tree"] = () => { calls++; throw new Error(`read failure ${calls}`); };

  app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
  await vi.advanceTimersByTimeAsync(BACKOFF);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(calls).toBe(5);
  screen.getByRole("treeitem", { name: /Last valid work/ });

  app.handlers["rail.tree"] = () => {
    calls++;

    return [node("new", { name: "Acknowledged recovery" })];
  };

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await vi.advanceTimersByTimeAsync(0);
  screen.getByText("Acknowledged recovery");
  expect(calls).toBe(6);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("u3791a_retry_keeps_original_revision", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
  await vi.advanceTimersByTimeAsync(BACKOFF);
  await settled;
  expect(targets).toEqual(Array(5).fill("original-file"));
  expect(app.calls.filter(call => call.method === "agent.compareFile").map(call => call.params)).toEqual(
    Array(5).fill({ id: "original-agent", path: "original-file" }),
  );
});

it.each([new RpcError(-32002, "refused"), new RpcError(-32603, "internal"), new RpcError(-32004, "unknown"), new Error("disconnect")])("u3791a_remote_commands_are_not_replayed_%s", async error => {
  const app = createFakeApp();
  const connected = await connectProject(app, { path: "/p", name: "p" }, () => true, () => 0);
  app.handlers["message.send"] = () => { throw error; };

  await expect(connected.app.rpc("message.send", { to: "agent", kind: "note", body: " exact draft 😀\n ", replyTo: null })).rejects.toBe(error);
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1);
});


it("u3791a_project_read_exhaustion_keeps_explicit_retry", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const app = createFakeApp();
  app.opened.project = { name: "project", path: "/p" };
  app.handlers["rail.tree"] = () => [node("kept", { name: "Recovered Project work" })];

  const list = vi.spyOn(app, "projects");

  for (let attempt = 1; attempt <= 10; attempt++) list.mockRejectedValueOnce(attempt === 1 ? new TypeError("first") : new Error(`failure ${attempt}`));

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await vi.advanceTimersByTimeAsync(BACKOFF);
  screen.getByRole("alert", { name: "failure 5" });
  expect(list).toHaveBeenCalledTimes(5);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await vi.advanceTimersByTimeAsync(BACKOFF);
  screen.getByRole("alert", { name: "failure 10" });
  expect(list).toHaveBeenCalledTimes(10);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await vi.advanceTimersByTimeAsync(0);
  screen.getByRole("treeitem", { name: /Recovered Project work/ });
  expect(list).toHaveBeenCalledTimes(11);
  expect(screen.queryByRole("alert")).toBeNull();
});


it("u6249b_a_refused_scheme_push_adds_no_second_line_beside_the_rail_failure", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const app = createFakeApp();

  app.handlers["terminal.scheme"] = () => { throw new Error("same diagnostic"); };

  app.handlers["rail.tree"] = () => { throw new Error("same diagnostic"); };

  const connecting = connectProject(app, { name: "project", path: "/p" }, () => true, () => 0);
  await vi.advanceTimersByTimeAsync(BACKOFF);
  const connected = await connecting;

  render(() => <ConnectedProjectContext.Provider value={connected}>
    <Pane notice={connected.rail.failure()} retryNotice={() => void connected.rail.refresh({ terminals: true })} />
  </ConnectedProjectContext.Provider>);

  try {
    await vi.advanceTimersByTimeAsync(0);
    screen.getByRole("alert");
    expect(app.calls.filter(call => call.method === "terminal.scheme")).toHaveLength(1);
    app.handlers["rail.tree"] = () => [node("kept", { name: "Recovered work" })];
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(connected.rail.failure()).toBeNull();
    expect(connected.rail.nodes.map(node => node.id)).toEqual(["kept"]);
    expect(app.calls.filter(call => call.method === "rail.tree")).toHaveLength(6);
    expect(app.calls.filter(call => call.method === "terminal.scheme")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  } finally { connected.stopTerminalScheme(); }
});
