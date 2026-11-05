import { cleanup } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appSettings, saveAppSettings } from "../settings/preferences";
import { agent, USER } from "../testing/nodes";
import { TOAST_AGENT, by, mountToasts, status, toastTodo } from "./toastFixture";

const tree = () => [agent("a", "idle", "x", { name: "scout" }), agent("b", "idle", "x", { name: "mason", alert_level: "all" })];

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersToNextFrame();
};

const everythingOn = () => {
  // SAFETY: the entries keep the keys of the settings' own state table, so the record keeps its type.
  const all = Object.fromEntries(Object.keys(appSettings().stateAlerts).map(state => [state, { alert: true, sound: true, badge: true }])) as ReturnType<typeof appSettings>["stateAlerts"];

  return saveAppSettings({ stateAlerts: all });
};

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe("u6220d a Project's alert level narrows what its Agents raise", () => {
  it("u6220d_all_follows_settings", async () => {
    const { app } = await mountToasts(tree(), { front: false, project: "all" });

    await everythingOn();
    app.emit(status("a", "done"));
    app.emit(status("b", "needs-you"));
    await settle();

    expect(app.stateAlerts.map(alert => alert.body)).toEqual(["Done", "Needs you"]);
  });

  it("u6220d_needs_you_only_raises_only_needs_you_and_error_even_for_an_agent_at_all", async () => {
    const { app, sounds } = await mountToasts(tree(), { front: false, project: "needs-you" });

    await everythingOn();
    app.emit(status("a", "done"));
    app.emit(status("b", "idle"));
    app.emit(status("a", "working"));
    await settle();

    expect(app.stateAlerts).toEqual([]);
    expect(sounds).toEqual([]);

    app.emit(status("a", "needs-you"));
    app.emit(status("b", "error"));
    await settle();

    expect(app.stateAlerts.map(alert => alert.body)).toEqual(["Needs you", "Error"]);
  });

  it("u6220d_off_raises_no_alert_and_no_sound_but_the_toast_still_shows_silently", async () => {
    const { app, sounds, toasts } = await mountToasts(tree(), { front: true, project: "off" });

    await everythingOn();
    app.emit(status("a", "needs-you"));
    app.emit(status("b", "error"));
    app.emit(status("a", "done"));
    await settle();

    expect(app.stateAlerts).toEqual([]);
    expect(sounds).toEqual([]);
    expect(toasts().length).toBeGreaterThan(0);
  });

  it("u6220d_a_narrowed_project_leaves_the_five_second_window_alone", async () => {
    const { app } = await mountToasts(tree(), { front: false, project: "needs-you" });

    await everythingOn();
    app.emit(status("a", "done"));
    app.emit(status("a", "needs-you"));
    await settle();

    expect(app.stateAlerts.map(alert => alert.body)).toEqual(["Needs you"]);
  });

  it("u6220d_a_todo_edit_toast_is_silent_below_all", async () => {
    const todos = [toastTodo(7, USER, "ship it")];

    for (const [project, chimes] of [["all", 1], ["needs-you", 0], ["off", 0]] as const) {
      const { app, sounds, toasts } = await mountToasts([agent("a", "idle", "x", { name: "scout" })], { todos, project });

      app.emit(by(TOAST_AGENT, { name: "todo.updated", data: todos[0]! }));
      await settle();

      expect(toasts()).toHaveLength(1);
      expect(sounds).toHaveLength(chimes);
      cleanup();
    }
  });
});
