import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openTabs, path } from "../header/stripFixture";
import { agent, event } from "../testing/nodes";
import type { FakeApp } from "../testing/fakeApp";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });

beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
});

const HOUR = 3_600_000;

const finishAt = (app: FakeApp, project: string, id: string, at: number, round = 1) => {
  vi.setSystemTime(at);
  app.of(path(project)).emit(event({ name: "agent.status", data: { id, attempt: "1", status_revision: String(round + 1), status: { kind: "idle", label: "settled", since: at, finished: String(round) } } }));
};

const labels = (app: FakeApp) => app.menuBar?.entries.map(entry => entry.label);

it("u5959a_rows_project_title_badge_and_subtitle", async () => {
  const { app } = await openTabs({ api: [agent("fix-the-ÉLAN-bug", "needs-you", "question"), agent("😀-party", "error", "failure"), agent("日本語", "working", "running")] }, false, Date.now);

  await waitFor(() => expect(labels(app)).toEqual(["Waiting", "Fix the ÉLAN bug", "😀 party", "Open roundup"]));
  // One open Project: its name and the separator are omitted.
  expect(app.menuBar?.entries.map(entry => [entry.head, entry.state, entry.subtitle])).toEqual([
    [true, undefined, undefined], [undefined, "needs-you", "question"], [undefined, "error", "failure"], [undefined, undefined, undefined],
  ]);
  expect(app.menuBar?.entries.slice(1, 3).map(entry => Number.isFinite(entry.since))).toEqual([true, true]);
});

it("u5959a_the_project_name_follows_the_live_line_with_two_projects", async () => {
  const { app } = await openTabs({ api: [agent("a", "needs-you", "question")], web: [agent("b", "needs-you", "answer")] }, false, Date.now);

  await waitFor(() => expect(app.menuBar?.entries.map(entry => entry.subtitle)).toEqual([undefined, "question · api", "answer · web", undefined]));
});

it("u5959b_ready_rows_keep_the_last_hour", async () => {
  const now = 2 * HOUR;
  const { app } = await openTabs({ api: ["fresh", "edge", "stale", "old", "tick"].map(id => agent(id, "working", "running")).concat(agent("waits", "needs-you", "question", { status: { kind: "needs-you", label: "question", since: 1, finished: "0" } })) }, false, Date.now);
  finishAt(app, "api", "fresh", now - 59 * 60_000);
  finishAt(app, "api", "edge", now - HOUR);
  finishAt(app, "api", "stale", now - 61 * 60_000);
  finishAt(app, "api", "old", now - 3 * HOUR);
  finishAt(app, "api", "old", now - 30 * 60_000, 2);
  finishAt(app, "api", "tick", now);

  await waitFor(() => expect(labels(app)).toEqual(["Waiting", "Waits", "Ready", "Tick", "Old", "Fresh", "Edge", "1 earlier…", "Open roundup"]));
  expect(app.menuBar?.mark).toBe("waiting");
});

it("u5959b_limit_and_commands_after_the_cut", async () => {
  const { app } = await openTabs({ api: ["a", "b"].map(id => agent(id, "working", "running")) }, false, Date.now);
  finishAt(app, "api", "a", 10);
  finishAt(app, "api", "b", 20);
  vi.setSystemTime(3 * HOUR);
  app.of(path("api")).emit(event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: "3", status: { kind: "working", label: "running", since: 3 * HOUR, finished: "1" } } }));

  await waitFor(() => expect(labels(app)).toEqual(["Nothing for you", "2 earlier…", "Open roundup"]));
  expect(app.menuBar?.mark).toBe("ready");
  expect(app.menuBar?.entries[1]?.action).toEqual({ kind: "open" });
});

it("u5959c_dock_applies_the_hour_cut_and_five_row_limit", async () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  const { app } = await openTabs({ api: ids.map(id => agent(id, "working", "running")).concat(agent("old", "working", "running")) }, false, Date.now);
  finishAt(app, "api", "old", 0);

  for (const id of ids) finishAt(app, "api", id, 2 * HOUR);

  await waitFor(() => expect(app.menuBar?.dock.map(entry => entry.label)).toEqual(["Ready", "A", "B", "C", "D", "E", "1 earlier…", "2 more…", "Open roundup"]));
  expect(app.menuBar?.entries.map(entry => entry.label)).toContain("1 earlier…");
  expect(app.menuBar?.dock.filter(entry => entry.state).every(entry => entry.subtitle === "settled")).toBe(true);
});

it("u5959c_dock_rows_share_the_menu_bar_look", async () => {
  const { app } = await openTabs({ api: [agent("a-b", "working", "running")] }, false, Date.now);
  finishAt(app, "api", "a-b", 0);
  vi.setSystemTime(HOUR / 2);
  finishAt(app, "api", "a-b", HOUR / 2, 2);

  await waitFor(() => expect(app.menuBar?.dock).toEqual(app.menuBar?.entries));
  expect(app.menuBar?.dock[1]).toMatchObject({ label: "A b", subtitle: "settled", state: "ready", since: HOUR / 2 });
});
