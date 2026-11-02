import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { agent, event, USER } from "../testing/nodes";
import { mountToasts, status, by, TOAST_AGENT, toastTodo } from "./toastFixture";

afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

it("u5501_levels_override_only_their_channels", async () => {
  vi.useFakeTimers();

  const { app, sounds, setFront, connected } = await mountToasts([
    agent("all", "working", "busy", { alert_level: "all" }),
    agent("quiet", "working", "busy", { alert_level: "quiet" }),
    agent("default", "working", "busy"),
  ], { front: false });

  app.emit(status("all", "idle"));
  app.emit(status("quiet", "needs-you"));
  app.emit(status("default", "idle"));
  await vi.advanceTimersByTimeAsync(0);
  expect(app.stateAlerts).toEqual([{ agent: "all", title: "all", body: "Idle", alert: true, sound: true }]);
  expect(sounds).toEqual([]);
  app.emit(status("all", "done"));
  await vi.advanceTimersByTimeAsync(4999);
  expect(app.stateAlerts).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  app.emit(status("all", "blocked"));
  await vi.advanceTimersByTimeAsync(0);
  expect(app.stateAlerts).toHaveLength(2);

  for (const kind of ["needs-you", "error", "working", "done", "idle"] as const) {
    await vi.advanceTimersByTimeAsync(5000);
    app.emit(status("all", kind));
  }

  expect(app.stateAlerts).toHaveLength(7);
  setFront(true);
  connected.rail.select("all");
  await vi.advanceTimersByTimeAsync(5000);
  app.emit(status("all", "blocked"));
  expect(app.stateAlerts).toHaveLength(7);
  connected.rail.select(null);
  app.emit(status("all", "working"));
  expect(app.stateAlerts.at(-1)).toMatchObject({ alert: false, sound: true });
});

it("u5501_quiet_removes_existing_and_away_queued_toasts_without_replay", async () => {
  const tree = [agent("a", "working", "busy"), agent("b", "working", "busy")];
  const { app, connected, toasts, leaveWindow, comeBack } = await mountToasts(tree);
  app.emit(status("a", "needs-you"));
  await waitFor(() => expect(toasts()).toHaveLength(1));
  leaveWindow();
  app.emit(status("b", "error"));
  app.handlers["rail.tree"] = () => tree.map(node => ({ ...node, alert_level: "quiet" as const }));
  app.emit(event({ name: "rail.changed" }));
  await connected.rail.settled();
  comeBack();
  await waitFor(() => expect(toasts()).toHaveLength(0));
});

it("u5501_quiet_holds_one_row_per_eligible_event", async () => {
  vi.useFakeTimers();
  const { app, connected, sounds, toasts } = await mountToasts([agent("a", "working", "busy", { alert_level: "quiet" })], { selected: "a" });
  app.emit(status("a", "working"));
  app.emit(status("a", "idle"));
  app.emit(status("a", "needs-you"));
  app.emit(status("a", "error"));
  app.emit(status("a", "error"));
  await waitFor(() => expect(connected.held.rows()).toHaveLength(2));
  expect(connected.held.rows().map(row => [row.agent, row.kind])).toEqual([["a", "error"], ["a", "needs-you"]]);
  app.emit(by(TOAST_AGENT, { name: "todo.updated", data: toastTodo(7, USER) }));
  expect(connected.held.rows()).toHaveLength(3);
  app.emit(by(TOAST_AGENT, { name: "todo.updated", data: toastTodo(8, TOAST_AGENT) }));
  app.emit(event({ name: "todo.deleted", data: { id: 7 } }));
  app.handlers["rail.tree"] = () => [agent("a", "error", "error", { alert_level: "default" })];
  await connected.rail.refresh();
  expect(connected.held.rows()).toHaveLength(3);
  expect(sounds).toEqual([]);
  expect(toasts()).toEqual([]);
  expect(app.stateAlerts).toEqual([]);
});

it("u5501_settings_changes_keep_each_agents_level", async () => {
  const { app, connected } = await mountToasts([agent("a", "working", "busy", { alert_level: "quiet" })]);
  const { appSettings, saveAppSettings } = await import("../settings/preferences");
  await saveAppSettings({ stateAlerts: { ...appSettings().stateAlerts, done: { alert: true, sound: true, badge: true } } });
  expect(connected.rail.nodes[0]?.alert_level).toBe("quiet");
  expect(connected.held.rows()).toHaveLength(0);
  app.emit(status("a", "done"));
  await waitFor(() => expect(connected.held.rows()).toHaveLength(1));
  expect(app.calls.filter(call => call.method === "rail.setAlertLevel")).toEqual([]);
  expect(app.stateAlerts).toEqual([]);
});

it("u5501_quiet_filters_all_outputs_across_projects", async () => {
  const { openTabs, path, treeOf, changed } = await import("../header/stripFixture");
  const { door } = await import("../testing/nodes");
  const { appSettings, saveAppSettings } = await import("../settings/preferences");
  const quiet = door("quiet-door", "working", "busy", { alert_level: "quiet" });
  const control = agent("control", "needs-you", "asks");
  const background = agent("background", "working", "busy", { alert_level: "quiet" });
  const { app } = await openTabs({ api: [quiet, control], web: [background] });
  await saveAppSettings({ stateAlerts: { ...appSettings().stateAlerts, done: { alert: true, sound: true, badge: true } } });
  await waitFor(() => expect(app.badges.at(-1)).toBe(1));
  app.of(path("api")).emit(status("quiet-door", "error"));
  app.of(path("web")).emit(status("background", "needs-you"));
  await waitFor(() => expect(app.badges.at(-1)).toBe(1));
  expect(app.stateAlerts).toEqual([]);
  treeOf(app, "api", [{ ...quiet }, { ...control, alert_level: "quiet" }]);
  await changed(app, "api");
  await waitFor(() => expect(app.badges.at(-1)).toBe(0));
  treeOf(app, "api", [{ ...quiet }, { ...control, alert_level: "default" }]);
  await changed(app, "api");
  await waitFor(() => expect(app.badges.at(-1)).toBe(1));
  expect(app.stateAlerts).toEqual([]);
});
