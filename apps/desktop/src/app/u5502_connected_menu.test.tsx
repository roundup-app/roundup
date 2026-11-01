import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openTabs, renderTabs, path, tab } from "../header/stripFixture";
import { agent, door, event, workstream } from "../testing/nodes";
import type { FakeApp } from "../testing/fakeApp";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });

const actions = (app: FakeApp) => app.menuBar?.entries.flatMap(entry => entry.action?.kind === "agent" ? [entry.action] : []) ?? [];

const finish = (app: FakeApp, project: string, id: string) => app.of(path(project)).emit(event({ name: "agent.status", data: {
  id, attempt: "1", status_revision: "2", status: { kind: "idle", label: "settled", since: 10, finished: "1" },
} }));

it("u5502_waiting_wins_without_duplicating_an_agent", async () => {
  const { app } = await openTabs({ api: [agent("waiting", "needs-you", "question"), agent("ready", "working", "running")], web: [agent("other", "working", "running")] });
  finish(app, "api", "ready");

  await waitFor(() => expect(actions(app)).toEqual([
    { kind: "agent", path: path("api"), agent: "waiting" },
    { kind: "agent", path: path("api"), agent: "ready" },
  ]));
  expect(app.menuBar?.mark).toBe("waiting");
  expect(app.stateAlerts).toEqual([]);
});

it("u5502_projects_and_doors_keep_distinct_identities", async () => {
  const { app } = await openTabs({ api: [door("same", "needs-you", "question"), workstream("aggregate")], web: [agent("same", "error", "failure")] });

  await waitFor(() => expect(actions(app)).toEqual([
    { kind: "agent", path: path("api"), agent: "same" },
    { kind: "agent", path: path("web"), agent: "same" },
  ]));
  app.menuBarAction({ kind: "agent", path: path("api"), agent: "same" });
  await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
  expect(document.querySelector('[role=treeitem][data-id="same"]')?.getAttribute("aria-selected")).toBe("true");
  app.menuBarAction({ kind: "agent", path: path("api"), agent: "gone" });
  await screen.findByText("That is gone");
});

it("u5502_open_and_more_do_not_acknowledge_results", async () => {
  const { app } = await openTabs({ api: [agent("a", "working", "running")], web: [agent("b", "idle", "resting")] });
  finish(app, "api", "a");
  await waitFor(() => expect(app.menuBar?.mark).toBe("ready"));
  app.menuBarAction({ kind: "open" });
  expect(actions(app)).toHaveLength(1);
  app.menuBarAction({ kind: "agent", path: path("api"), agent: "a" });
  await waitFor(() => expect(actions(app)).toHaveLength(0));
  expect(app.calls.filter(call => /prompt|start|acceptResult|write|message.send/.test(call.method))).toEqual([]);
});

it.each([0, 7, 8, 10])("u5502_seven_rows_share_one_limit (%i)", async count => {
  const { app } = await openTabs({ api: Array.from({ length: count }, (_, index) => agent(String(index), "needs-you", "question")) });
  await waitFor(() => expect(app.menuBar).not.toBeNull());
  await waitFor(() => expect(actions(app)).toHaveLength(Math.min(count, 7)));
  expect(app.menuBar?.entries.filter(entry => entry.action?.kind === "open")).toHaveLength(count > 7 ? 2 : 1);
});

it("u5502_later_results_rearm_without_replay", async () => {
  const { app } = await openTabs({ api: [agent("a", "idle", "resting"), agent("other", "idle", "resting")], web: [agent("b", "idle", "resting")] });
  const records: import("@contracts/deliverable/Deliverable").Deliverable[] = [];
  const daemon = app.of(path("api"));
  daemon.handlers["deliverable.list"] = () => [...records];

  const publish = (id: string) => {
    records.push({ project: "api-key", id, maker: { kind: "agent", id: "a", parent: null }, maker_name: "a", home: null, title: "Result", published_at: 100, target: { kind: "external", url: "https://example.com", availability: "not-checked" } });
    daemon.emit(event({ name: "deliverable.changed" }));
  };

  publish("first");
  await waitFor(() => expect(actions(app)).toEqual([{ kind: "agent", path: path("api"), agent: "a" }]));
  app.menuBarAction({ kind: "agent", path: path("api"), agent: "a" });
  await waitFor(() => expect(actions(app)).toHaveLength(0));
  fireEvent.click(tab("web"));
  const reads = daemon.calls.filter(call => call.method === "deliverable.list").length;
  daemon.emit(event({ name: "deliverable.changed" }));
  await waitFor(() => expect(daemon.calls.filter(call => call.method === "deliverable.list").length).toBeGreaterThan(reads));
  expect(actions(app)).toHaveLength(0);
  publish("second");
  await waitFor(() => expect(actions(app)).toHaveLength(1));
});


it("u5502_reload_reconciles_ready_results", async () => {
  const trees = { api: [agent("a", "idle", "resting")], web: [agent("b", "idle", "resting")] };
  const publication = (id: string): import("@contracts/deliverable/Deliverable").Deliverable => ({ project: "api-key", id, maker: { kind: "agent", id: "a", parent: null }, maker_name: "a", home: null, title: "Published result", published_at: 100, target: { kind: "external", url: "https://example.com", availability: "not-checked" } });
  const records = [publication("history")];
  const first = renderTabs(trees);
  first.app.of(path("api")).handlers["deliverable.list"] = () => [...records];
  await waitFor(() => expect(first.app.menuBar?.mark).toBe("empty"));
  records.push(publication("unread"));
  first.app.of(path("api")).emit(event({ name: "deliverable.changed" }));
  await waitFor(() => expect(actions(first.app)).toHaveLength(1));
  cleanup();
  records.push(publication("gap"));
  const next = renderTabs(trees, true);
  next.app.of(path("api")).handlers["deliverable.list"] = () => [...records];
  await waitFor(() => expect(actions(next.app)).toHaveLength(1));
  next.app.menuBarAction({ kind: "agent", path: path("api"), agent: "a" });
  await waitFor(() => expect(actions(next.app)).toHaveLength(0));
  cleanup();
  const read = renderTabs(trees, true);
  read.app.of(path("api")).handlers["deliverable.list"] = () => [...records];
  await waitFor(() => expect(read.app.menuBar?.mark).toBe("empty"));
});


it("u5502_menu_groups_and_orders_agents", async () => {
  const { app } = await openTabs({ api: [
    agent("older", "needs-you", "question", { status: { kind: "needs-you", label: "question", since: 1, finished: "0" } }),
    agent("newer", "error", "failure", { status: { kind: "error", label: "failure", since: 2, finished: "0" } }),
  ], web: [agent("tie", "needs-you", "question", { status: { kind: "needs-you", label: "question", since: 1, finished: "0" } })] });

  await waitFor(() => expect(actions(app).map(action => action.agent)).toEqual(["older", "tie", "newer"]));
  app.of(path("api")).emit(event({ name: "agent.status", data: { id: "older", attempt: "1", status_revision: "2", status: { kind: "needs-you", label: "a later live line", since: 100, finished: "0" } } }));
  await waitFor(() => expect(app.menuBar?.entries.find(entry => entry.action?.kind === "agent" && entry.action.agent === "older")?.since).toBe(1));
  expect(actions(app).map(action => action.agent)).toEqual(["older", "tie", "newer"]);
});
