import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openTabs, path, tab } from "../header/stripFixture";
import { agent, door, event, workstream } from "../testing/nodes";
import type { FakeApp } from "../testing/fakeApp";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });

const rows = (app: FakeApp, surface: "dock" | "entries" = "dock") => app.menuBar?.[surface]?.flatMap(entry => entry.action?.kind === "agent" ? [entry] : []) ?? [];

const finish = (app: FakeApp, project: string, id: string, count = "1") => app.of(path(project)).emit(event({ name: "agent.status", data: { id, attempt: "1", status_revision: String(Number(count) + 1), status: { kind: "idle", label: "settled", since: 10 * Number(count), finished: count } } }));

it.each([0, 1, 5, 6, 8, 10])("u5503_five_rows_share_one_limit (%s)", async count => {
  const { app } = await openTabs({ api: Array.from({ length: count }, (_, index) => agent(String(index), "needs-you", "question")) });
  await waitFor(() => expect(app.menuBar?.dock).toBeDefined());
  expect(app.menuBar?.dock.flatMap(entry => entry.action?.kind === "agent" ? [entry.action.agent] : [])).toEqual(Array.from({ length: Math.min(count, 5) }, (_, index) => String(index)));
  expect(app.menuBar?.dock.filter(entry => entry.action?.kind === "open")).toHaveLength(count > 5 ? 2 : 1);
  expect(app.menuBar?.dock.filter(entry => entry.action === null)).toHaveLength(1);
});


it("u5503_dock_uses_the_same_ordered_agents", async () => {
  const { app } = await openTabs({ api: [door("a", "needs-you", "question"), agent("both", "needs-you", "question"), agent("quiet", "needs-you", "question", { alert_level: "quiet" }), workstream("aggregate"), agent("ready", "working", "running")], web: [agent("a", "error", "failed"), agent("ready", "working", "running")] });
  finish(app, "api", "ready");
  finish(app, "web", "ready");
  app.of(path("api")).emit(event({ name: "agent.status", data: { id: "both", attempt: "1", status_revision: "2", status: { kind: "needs-you", label: "later line", since: 100, finished: "1" } } }));
  await waitFor(() => expect(rows(app)).toHaveLength(5));
  expect(rows(app)).toEqual(rows(app, "entries"));
  expect(rows(app).map(row => row.action)).toEqual([
    { kind: "agent", path: path("api"), agent: "a" },
    { kind: "agent", path: path("api"), agent: "both" },
    { kind: "agent", path: path("web"), agent: "a" },
    { kind: "agent", path: path("api"), agent: "ready" },
    { kind: "agent", path: path("web"), agent: "ready" },
  ]);
});

it.each([2, 5, 8])("u5503_five_rows_share_one_limit_across_groups (%s Waiting)", async waiting => {
  const { app } = await openTabs({ api: Array.from({ length: 10 }, (_, i) => agent(String(i), i < waiting ? "needs-you" : "working", "live")) });

  for (let i = waiting; i < 10; i++) finish(app, "api", String(i));
  await waitFor(() => expect(rows(app, "entries")).toHaveLength(7));
  expect(rows(app)).toEqual(rows(app, "entries").slice(0, 5));
  expect(app.menuBar?.dock.filter(entry => entry.action === null)).toHaveLength(waiting < 5 ? 2 : 1);
});

it("u5503_dock_and_menu_bar_share_opening_and_acknowledgement", async () => {
  const { app } = await openTabs({ api: [agent("same", "working", "live"), agent("waiting", "needs-you", "question")], web: [agent("same", "working", "live")] });
  finish(app, "api", "same");
  finish(app, "web", "same");
  await waitFor(() => expect(rows(app)).toHaveLength(3));
  const chosen = rows(app).find(row => row.action?.kind === "agent" && row.action.path === path("api") && row.action.agent === "same")!.action!;
  app.menuBarAction(chosen);
  await waitFor(() => expect(rows(app)).toHaveLength(2));
  expect(tab("api").getAttribute("aria-selected")).toBe("true");
  expect(document.querySelector('[role=treeitem][data-id="same"]')?.getAttribute("aria-selected")).toBe("true");
  expect(rows(app)).toEqual(rows(app, "entries"));
  app.menuBarAction({ kind: "agent", path: path("api"), agent: "waiting" });
  await waitFor(() => expect(document.querySelector('[role=treeitem][data-id="waiting"]')?.getAttribute("aria-selected")).toBe("true"));
  expect(rows(app).some(row => row.action?.kind === "agent" && row.action.agent === "waiting")).toBe(true);
  finish(app, "api", "same", "2");
  await waitFor(() => expect(rows(app)).toHaveLength(3));
  app.menuBarAction({ kind: "agent", path: path("api"), agent: "removed" });
  await screen.findByText("That is gone");
  expect(document.querySelector('[role=treeitem][data-id="waiting"]')?.getAttribute("aria-selected")).toBe("true");
});

it("u5503_only_an_agent_action_opens_and_acknowledges", async () => {
  const { app } = await openTabs({ api: Array.from({ length: 8 }, (_, i) => agent(String(i), "working", "live")) });
  fireEvent.blur(window);

  for (let i = 0; i < 8; i++) finish(app, "api", String(i));
  await waitFor(() => expect(rows(app)).toHaveLength(5));
  const before = app.menuBar;
  const show = vi.spyOn(app, "showWindow");
  const calls = app.of(path("api")).calls.length;
  expect(show).not.toHaveBeenCalled();
  app.menuBarAction({ kind: "failure", message: "Dock section could not be refreshed" });
  await screen.findByText("Dock section could not be refreshed");
  expect(show).not.toHaveBeenCalled();

  for (const entry of app.menuBar!.dock.filter(entry => entry.action?.kind === "open")) app.menuBarAction(entry.action!);
  expect(show).toHaveBeenCalledTimes(2);
  expect(app.menuBar).toEqual(before);
  expect(app.of(path("api")).calls.slice(calls)).toEqual([]);
  expect(app.stateAlerts).toEqual([]);
});

it.each([false, true])("u5503_menu_changes_leave_badge_behavior_unchanged (badge=%s)", async badge => {
  const { appSettings, saveAppSettings } = await import("../settings/preferences");

  const observe = async (menus: boolean) => {
    const { app } = await openTabs({ api: [agent("waiting", "needs-you", "question"), agent("ready", "working", "live")] });
    await saveAppSettings({ stateAlerts: { ...appSettings().stateAlerts, "needs-you": { badge, alert: false, sound: false } } });
    finish(app, "api", "ready");
    await waitFor(() => expect(rows(app)).toHaveLength(2));

    if (menus) {
      app.menuBarAction({ kind: "open" });
      app.menuBarAction({ kind: "agent", path: path("api"), agent: "ready" });
      await waitFor(() => expect(rows(app)).toHaveLength(1));
    }

    app.of(path("api")).emit(event({ name: "agent.status", data: { id: "waiting", attempt: "1", status_revision: "2", status: { kind: "idle", label: "resting", since: 30, finished: "0" } } }));
    await waitFor(() => expect(app.badges.at(-1)).toBe(0));
    const badges = [...app.badges];
    cleanup();
    localStorage.clear();

    return badges;
  };

  expect(await observe(true)).toEqual(await observe(false));
});

it("u5503_an_unavailable_dock_menu_reports_its_cause", async () => {
  const { app } = await openTabs({ api: [agent("a", "working", "live")] });
  const install = vi.spyOn(app, "setMenuBar").mockRejectedValueOnce(new Error("Dock callback installation refused"));
  const show = vi.spyOn(app, "showWindow");
  finish(app, "api", "a");
  await screen.findByText("Error: Dock callback installation refused");
  expect(install).toHaveBeenCalledOnce();
  expect(show).not.toHaveBeenCalled();
});
