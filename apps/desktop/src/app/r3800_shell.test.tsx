import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { node } from "../testing/nodes";
import { openProjectPage } from "../testing/menuProbe";
import { fakeEmulators } from "../terminal/paneHarness";

afterEach(() => { cleanup(); localStorage.clear(); });

it.each(["initial open", "reopen"])("r3800_shell_needs_at_most_one_rpc_reply: %s", async mode => {
  const app = createFakeApp();
  app.opened.project = { name: "payments-api", path: "/work/payments-api" };
  app.handlers["rail.tree"] = () => [node("seeded", { name: "Seeded Agent" })];
  const rpc = app.rpc;
  const subscribe = app.subscribe;
  const pending: (() => void)[] = [];
  let holding = mode === "initial open";
  let completed = 0;
  let reopen: HTMLElement | undefined;

  const reply = async () => {
    if (holding) await new Promise<void>(resolve => pending.push(resolve));
    completed++;
  };

  app.rpc = async (method, params) => {
    await reply();

    return rpc(method, params);
  };

  app.subscribe = async (...args) => {
    await reply();

    return subscribe(...args);
  };

  const projects = app.projects;
  app.projects = async () => {
    completed++;

    return projects();
  };

  const open = app.openProject;
  app.openProject = async path => {
    completed++;

    return open(path);
  };

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);

  if (mode === "reopen") {
    await screen.findByRole("textbox", { name: "Ask" });
    openProjectPage("view:workstreams", app.opened.project.path);
    await within(await screen.findByRole("region", { name: "Rail" })).findByText("Seeded Agent");
    holding = true;
    completed = 0;
    app.exitDaemon({ code: 1 });
    reopen = screen.getByRole("button", { name: "Reopen" });
    fireEvent.click(reopen);
  }

  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  const rail = await screen.findByRole("region", { name: "Rail" });
  const centre = screen.getByRole("region", { name: "Centre" });
  expect(screen.getByRole("tabpanel", { name: app.opened.project.name })).toBeTruthy();

  if (mode === "initial open") {
    expect(rail.getAttribute("aria-busy")).toBe("true");
    expect(centre.getAttribute("aria-busy")).toBe("true");
    expect(within(centre).getAllByRole("img")).toHaveLength(1);
  }

  expect(completed).toBeLessThanOrEqual(1);
  expect(pending.length).toBeGreaterThan(0);

  holding = false;

  for (const resolve of pending) resolve();

  if (reopen) await waitFor(() => expect(reopen?.isConnected).toBe(false));

  await screen.findByRole("textbox", { name: "Ask" });
  openProjectPage("view:workstreams", app.opened.project.path);
  await within(await screen.findByRole("region", { name: "Rail" })).findByText("Seeded Agent");

  expect(rail.hasAttribute("aria-busy")).toBe(false);
  expect(centre.hasAttribute("aria-busy")).toBe(false);

  fireEvent.click(within(screen.getByRole("region", { name: "Rail" })).getByText("Seeded Agent"));
  await within(screen.getByRole("region", { name: "Rail" })).findByRole("treeitem", { selected: true });
});

it.each(["equal", "older", "newer", "missing"])("r3800_startup_preserves_contract_scheme_and_event_order: %s", async contract => {
  const app = createFakeApp();
  app.opened.project = { name: "payments-api", path: "/work/payments-api" };
  const ping = app.handlers["daemon.ping"]!;
  const methods = app.handlers["daemon.methods"]!;
  app.handlers["daemon.ping"] = async () => {
    const result = await ping(null);

    if (contract === "equal") return result;

    if (contract === "missing") {
      // SAFETY: pre-contract Daemons return a ping without the now-required contract field.
      return { pong: true } as typeof result;
    }

    return { ...result, contract: { fingerprint: "different" } };
  };

  app.handlers["daemon.methods"] = async () => {
    const names = await methods(null);

    return contract === "older" ? names.slice(1) : [...names, "future.method"];
  };

  const scheme = Promise.withResolvers<null>();
  const subscription = Promise.withResolvers<void>();
  app.handlers["terminal.scheme"] = () => scheme.promise;
  const subscribe = app.subscribe;
  app.subscribe = async (...args) => {
    await subscription.promise;

    return subscribe(...args);
  };

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await waitFor(() => expect(app.calls.some(call => call.method === "terminal.scheme")).toBe(true));
  expect(app.calls[0]?.method).toBe("daemon.ping");
  expect(app.calls.some(call => call.method === "daemon.methods")).toBe(contract === "older" || contract === "newer");
  expect(app.calls.some(call => call.method === "rail.tree")).toBe(false);
  scheme.resolve(null);
  await scheme.promise;
  expect(app.calls.some(call => call.method === "rail.tree")).toBe(false);
  app.handlers["rail.tree"] = () => {
    expect(app.subscribed).toHaveLength(1);

    return [];
  };

  subscription.resolve();
  await screen.findByRole("textbox", { name: "Ask" });

  if (contract !== "equal") {
    expect(screen.getByRole("alert")).toBeTruthy();
  }
});
