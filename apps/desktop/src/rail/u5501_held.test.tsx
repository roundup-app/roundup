import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, event } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { status } from "../toasts/toastFixture";
import type { ConnectedProject } from "../state/connectedProject";
import { useBrowserStorage } from "../state/storage";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const mount = async (keep = false, target: "agent" | "door" = "agent", crossProject = false) => {
  if (!keep) localStorage.clear();
  useBrowserStorage(localStorage);
  const app = createFakeApp();
  const tree = [(target === "door" ? door : agent)("a", "working", "busy", { name: "<b>A</b>", alert_level: "quiet" }), agent("b", "working", "busy", { alert_level: "quiet" })];
  app.opened.project = { name: "p", path: "/p" };
  app.handlers["rail.tree"] = () => tree;
  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 0, data: "c2NyZWVu" });

  if (crossProject) {
    app.of("/p");
    app.add("/q", "q");
    app.of("/q").handlers["rail.tree"] = () => [agent("a", "working", "other Project", { alert_level: "quiet" })];
  }

  const emulators = fakeEmulators();
  const chime = vi.fn();
  let connected: ConnectedProject | undefined;
  render(() => <App app={app} chime={chime} clock={Date.now} reducedMotion={() => true} createEmulator={emulators.factory} prepareIdle={open => { connected = open; }} />);
  await waitFor(() => expect(connected).toBeDefined());

  if (crossProject) {
    fireEvent.click(screen.getByRole("tab", { name: "p" }));
    await waitFor(() => expect(connected?.project.path).toBe("/p"));
  }

  const open = connected!;
  await waitFor(() => expect(document.querySelectorAll('.rail-row[data-id]')).toHaveLength(2));

  const hold = (id: string, kind: "needs-you" | "error", line = "<script>literal</script>") => {
    const change = status(id, kind);

    if (change.name === "agent.status") change.data.status.label = line;
    app.emit(change);
  };

  let other: ConnectedProject | undefined;

  if (crossProject) {
    fireEvent.click(screen.getByRole("tab", { name: "q" }));
    await waitFor(() => expect(connected?.project.path).toBe("/q"));
    other = connected;
    app.of("/q").emit(status("a", "needs-you"));
    await waitFor(() => expect(other!.held.rows()).toHaveLength(1));
    fireEvent.click(screen.getByRole("tab", { name: "p" }));
    await waitFor(() => expect(connected?.project.path).toBe("/p"));
  }

  return { app, connected: open, hold, tree, emulators, chime, other };
};

it.each(["agent", "door"] as const)("u5501_held_rows_keep_event_identity_content_and_order_across_reopen %s", async target => {
  vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  const first = await mount(false, target);
  fireEvent.click(document.querySelector('.rail-row[data-id="a"]')!);
  await waitFor(() => expect(first.emulators.made.get("t-a")?.written).toHaveLength(1));
  first.hold("a", "needs-you");
  first.hold("b", "error", "second");
  first.hold("a", "error", "third");
  expect(new Set(first.connected.held.rows().map(row => row.at)).size).toBe(1);
  const identities = structuredClone(first.connected.held.rows());
  const saved = identities.map(({ agent, name, kind, line }) => ({ agent, name, kind, line }));
  expect(saved).toEqual([
    { agent: "a", name: "<b>A</b>", kind: "error", line: "third" },
    { agent: "b", name: "b", kind: "error", line: "second" },
    { agent: "a", name: "<b>A</b>", kind: "needs-you", line: "<script>literal</script>" },
  ]);
  await waitFor(() => expect(localStorage.getItem("roundup:held:/p")).toContain("third"));
  cleanup();
  const reopened = await mount(true, target);
  await waitFor(() => expect(reopened.emulators.made.get("t-a")?.written).toHaveLength(1));
  expect(reopened.connected.rail.selected()).toBe("a");
  expect(reopened.connected.held.rows()).toEqual(identities);
  fireEvent.click(screen.getByRole("button", { name: /held/ }));
  await waitFor(() => expect(document.querySelectorAll(".held-row")).toHaveLength(3));
  expect(document.querySelector('.held-row script')).toBeNull();
  expect(document.querySelector('.held-row b')).toBeNull();
  expect(reopened.connected.held.rows()).toHaveLength(3);
});

it.each([
  { entry: "held", target: "agent" }, { entry: "rail", target: "agent" }, { entry: "alert", target: "agent" },
  { entry: "held", target: "door" }, { entry: "alert", target: "door" },
] as const)("u5501_opening_an_agent_clears_only_its_held_rows via $entry for $target", async ({ entry, target }) => {
  const { app, connected, hold, emulators, chime, other } = await mount(false, target, true);
  const otherRows = structuredClone(other!.held.rows());

  if (target === "door") {
    fireEvent.click(document.querySelector('.rail-row[data-id="a"]')!);
    await waitFor(() => expect(emulators.made.get("t-a")?.written).toHaveLength(1));
  }

  hold("a", "needs-you"); hold("b", "needs-you"); hold("a", "error");

  if (entry === "held") {
    fireEvent.click(screen.getByRole("button", { name: /held/ }));
    fireEvent.click(await waitFor(() => { const row = document.querySelector(".held-row"); expect(row).not.toBeNull();

 return row!; }));
  } else if (entry === "rail") fireEvent.click(document.querySelector('.rail-row[data-id="a"]')!);
  else app.clickStateAlert("a");
  await waitFor(() => expect(connected.held.rows().map(row => row.agent)).toEqual(["b"]));
  expect(connected.rail.selected()).toBe("a");
  expect(other!.held.rows()).toEqual(otherRows);
  expect(emulators.made.get("t-a")?.host?.isConnected).toBe(true);
  expect(emulators.made.get("t-a")?.written).toHaveLength(1);
  expect(app.stateAlerts).toEqual([]);
  expect(chime).not.toHaveBeenCalled();
  expect(app.calls.filter(call => ["message.send", "agent.resume", "terminal.write"].includes(call.method))).toEqual([]);
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a"));
  expect(document.activeElement?.closest(".pane-screen")).not.toBeNull();
  emulators.made.get("t-a")!.type(new TextEncoder().encode("marker"));
  await waitFor(() => expect(app.calls.filter(call => call.method === "terminal.write").map(call => call.params)).toEqual([{ id: "t-a", data: "bWFya2Vy" }]));
});

it.each([
  { target: "agent", mounted: false }, { target: "door", mounted: false },
  { target: "agent", mounted: true }, { target: "door", mounted: true },
] as const)("u5501_a_failed_or_gone_target_open_preserves_held_rows $target mounted=$mounted", async ({ target, mounted }) => {
  const { app, connected, hold, tree, emulators } = await mount(false, target);

  if (mounted) {
    fireEvent.click(document.querySelector('.rail-row[data-id="a"]')!);
    await waitFor(() => expect(emulators.made.get("t-a")?.written).toHaveLength(1));
    fireEvent.click(document.querySelector('.rail-row[data-id="b"]')!);
    await waitFor(() => expect(emulators.made.get("t-b")?.written).toHaveLength(1));
  }

  hold("a", "needs-you");
  app.handlers["terminal.snapshot"] = () => { throw new Error("Terminal unavailable. Try again."); };

  app.handlers["terminal.catchUp"] = () => { throw new Error("Terminal unavailable. Try again."); };

  fireEvent.click(screen.getByRole("button", { name: /held/ }));
  fireEvent.click(await waitFor(() => { const row = document.querySelector(".held-row"); expect(row).not.toBeNull();

 return row!; }));
  await screen.findByText(/Could not restore Terminal output/);
  expect(connected.held.rows()).toHaveLength(1);
  app.handlers["rail.tree"] = () => tree.filter(node => node.id !== "a");
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(connected.rail.nodes.some(node => node.id === "a")).toBe(false));
  fireEvent.click(await waitFor(() => { const row = document.querySelector(".held-row"); expect(row).not.toBeNull();

 return row!; }));
  expect(connected.held.rows()).toHaveLength(1);
  expect(connected.rail.selected()).not.toBe("b");
  await waitFor(() => expect(connected.rail.commandFailure.message()).toBeTruthy());
  expect(await screen.findByText(connected.rail.commandFailure.message()!)).toBeTruthy();
});

it.each([
  { mounted: false, expanded: false },
  { mounted: false, expanded: true },
  { mounted: true, expanded: false },
  { mounted: true, expanded: true },
])("u5721_workstream_selection_preserves_alerts mounted=$mounted expanded=$expanded", async ({ mounted, expanded }) => {
  const { app, connected, hold, emulators, chime } = await mount(false, "door");

  if (mounted) {
    fireEvent.click(document.querySelector('.rail-row[data-id="a"]')!);
    await waitFor(() => expect(emulators.made.get("t-a")?.written).toHaveLength(1));
    fireEvent.click(document.querySelector('.rail-row[data-id="b"]')!);
    await waitFor(() => expect(emulators.made.get("t-b")?.written).toHaveLength(1));
  }

  hold("a", "needs-you", "Door needs a decision");
  hold("b", "error", "Other Agent failed");
  hold("a", "error", "Door failed later");
  const saved = structuredClone(connected.held.rows());

  if (expanded) fireEvent.click(screen.getByRole("button", { name: /held/ }));
  fireEvent.click(document.querySelector('.rail-row[data-id="a"]')!);
  await waitFor(() => expect(emulators.made.get("t-a")?.written).toHaveLength(1));
  await waitFor(() => expect(document.querySelector('.pane-screen [data-terminal]')?.getAttribute("data-terminal")).toBe("t-a"));
  await waitFor(() => expect(app.calls.filter(call => call.method === "terminal.snapshot").map(call => call.params)).toEqual(mounted ? [{ id: "t-a" }, { id: "t-b" }, { id: "t-a" }] : [{ id: "t-a" }]));
  expect(screen.queryByRole("button", { name: /held/ })).not.toBeNull();
  expect(connected.held.rows()).toEqual(saved);

  if (!expanded) fireEvent.click(screen.getByRole("button", { name: /held/ }));
  await waitFor(() => expect(document.querySelectorAll(".held-row")).toHaveLength(3));
  expect([...document.querySelectorAll(".held-row")].map(row => row.querySelector("span span:last-child")?.textContent)).toEqual(saved.map(row => row.line));
  expect(connected.held.rows()).toEqual(saved);
  expect(app.stateAlerts).toEqual([]);
  expect(chime).not.toHaveBeenCalled();
  expect(app.calls.filter(call => ["message.send", "agent.resume", "agent.prompt", "terminal.write"].includes(call.method))).toEqual([]);
});
