import { cleanup } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { agent, event } from "../testing/nodes";
import { mountToasts, status } from "./toastFixture";

afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

it("u5501_levels_override_only_their_channels", async () => {
  vi.useFakeTimers();

  const { app, sounds } = await mountToasts([
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
});

it("u5501_quiet_removes_existing_and_away_queued_toasts_without_replay", async () => {
  const tree = [agent("a", "working", "busy"), agent("b", "working", "busy")];
  const { app, connected, toasts, leaveWindow, comeBack } = await mountToasts(tree);
  app.emit(status("a", "needs-you"));
  leaveWindow();
  app.emit(status("b", "error"));
  app.handlers["rail.tree"] = () => tree.map(node => ({ ...node, alert_level: "quiet" as const }));
  app.emit(event({ name: "rail.changed" }));
  await connected.rail.settled();
  comeBack();
  expect(toasts()).toHaveLength(0);
});
