import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { agent, event } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { status } from "../toasts/toastFixture";
import type { ConnectedProject } from "../state/connectedProject";
import { useBrowserStorage } from "../state/storage";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const mount = async (keep = false) => {
  if (!keep) localStorage.clear();
  useBrowserStorage(localStorage);
  const app = createFakeApp();
  const tree = [agent("a", "working", "busy", { name: "<b>A</b>", alert_level: "quiet" }), agent("b", "working", "busy", { alert_level: "quiet" })];
  app.opened.project = { name: "p", path: "/p" };
  app.handlers["rail.tree"] = () => tree;
  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 0, data: "" });
  let connected: ConnectedProject | undefined;
  render(() => <App app={app} clock={Date.now} reducedMotion={() => true} createEmulator={fakeEmulators().factory} prepareIdle={open => { connected = open; }} />);
  await waitFor(() => expect(connected).toBeDefined());
  const open = connected!;
  await waitFor(() => expect(document.querySelectorAll('.rail-row[data-id]')).toHaveLength(2));

  const hold = (id: string, kind: "needs-you" | "error", line = "<script>literal</script>") => {
    const change = status(id, kind);

    if (change.name === "agent.status") change.data.status.label = line;
    app.emit(change);
  };

  return { app, connected: open, hold, tree };
};

it("u5501_held_rows_keep_event_identity_content_and_order_across_reopen", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  const first = await mount();
  first.hold("a", "needs-you");
  first.hold("b", "error", "second");
  first.hold("a", "error", "third");
  expect(new Set(first.connected.held.rows().map(row => row.at)).size).toBe(1);
  const saved = first.connected.held.rows().map(({ agent, name, kind, line }) => ({ agent, name, kind, line }));
  expect(saved).toEqual([
    { agent: "a", name: "<b>A</b>", kind: "error", line: "third" },
    { agent: "b", name: "b", kind: "error", line: "second" },
    { agent: "a", name: "<b>A</b>", kind: "needs-you", line: "<script>literal</script>" },
  ]);
  await waitFor(() => expect(localStorage.getItem("roundup:held:/p")).toContain("third"));
  cleanup();
  const reopened = await mount(true);
  expect(reopened.connected.held.rows().map(({ agent, name, kind, line }) => ({ agent, name, kind, line }))).toEqual(saved);
  fireEvent.click(screen.getByRole("button", { name: /held/ }));
  await waitFor(() => expect(document.querySelectorAll(".held-row")).toHaveLength(3));
  expect(document.querySelector('.held-row script')).toBeNull();
  expect(document.querySelector('.held-row b')).toBeNull();
  expect(reopened.connected.held.rows()).toHaveLength(3);
});

it.each(["held", "rail", "alert"])("u5501_opening_an_agent_clears_only_its_held_rows via %s", async entry => {
  const { app, connected, hold } = await mount();
  hold("a", "needs-you"); hold("b", "needs-you"); hold("a", "error");

  if (entry === "held") {
    fireEvent.click(screen.getByRole("button", { name: /held/ }));
    fireEvent.click(await waitFor(() => { const row = document.querySelector(".held-row"); expect(row).not.toBeNull();

 return row!; }));
  } else if (entry === "rail") fireEvent.click(document.querySelector('.rail-row[data-id="a"]')!);
  else app.clickStateAlert("a");
  await waitFor(() => expect(connected.held.rows().map(row => row.agent)).toEqual(["b"]));
  expect(connected.rail.selected()).toBe("a");
  expect(app.calls.filter(call => ["message.send", "agent.resume", "terminal.write"].includes(call.method))).toEqual([]);
});

it("u5501_a_failed_or_gone_target_open_preserves_held_rows", async () => {
  const { app, connected, hold, tree } = await mount();
  hold("a", "needs-you");
  app.handlers["terminal.snapshot"] = () => { throw new Error("Terminal unavailable. Try again."); };

  fireEvent.click(screen.getByRole("button", { name: /held/ }));
  fireEvent.click(await waitFor(() => { const row = document.querySelector(".held-row"); expect(row).not.toBeNull();

 return row!; }));
  await screen.findByText(/Terminal unavailable/);
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
