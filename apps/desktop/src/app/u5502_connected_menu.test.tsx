import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openTabs, path, tab } from "../header/stripFixture";
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

it("u5502_seven_rows_share_one_limit", async () => {
  const { app } = await openTabs({ api: Array.from({ length: 8 }, (_, index) => agent(String(index), "needs-you", "question")) });
  await waitFor(() => expect(actions(app)).toHaveLength(7));
  expect(app.menuBar?.entries.filter(entry => entry.action?.kind === "open")).toHaveLength(2);
  fireEvent.click(tab("api"));
});
