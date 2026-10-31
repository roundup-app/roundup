import { cleanup, fireEvent } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { appSettings, saveAppSettings } from "../settings/preferences";
import { agent } from "../testing/nodes";
import { by, mountToasts, status } from "./toastFixture";

const tree = () => [agent("a", "idle", "x", { name: "scout" }), agent("b", "idle", "x", { name: "mason" })];

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersToNextFrame();
};

const turnOn = (state: string, choices: { alert: boolean; sound: boolean; badge: boolean }) =>
  saveAppSettings({ stateAlerts: { ...appSettings().stateAlerts, [state]: choices } });

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe("u5232 each choice follows the state", () => {
  it("u5232a_routine_progress_raises_nothing_by_default", async () => {
    const { app, sounds } = await mountToasts(tree(), { front: false });

    for (const kind of ["working", "blocked", "done"] as const) app.emit(status("a", kind));
    await settle();

    expect(app.stateAlerts).toEqual([]);
    expect(sounds).toEqual([]);
  });

  it("u5232c_each_choice_acts_only_when_on", async () => {
    const { app } = await mountToasts(tree(), { front: false });

    await turnOn("done", { alert: true, sound: false, badge: false });
    app.emit(status("a", "done"));
    await settle();
    await turnOn("blocked", { alert: false, sound: true, badge: false });
    app.emit(status("b", "blocked"));
    await settle();

    expect(app.stateAlerts).toEqual([
      { agent: "a", title: "scout", body: "Done", alert: true, sound: false },
      { agent: "b", title: "mason", body: "Blocked", alert: false, sound: true },
    ]);
  });

  it("u5232c_the_alert_names_the_agent_and_the_state_only", async () => {
    const { app } = await mountToasts(tree(), { front: false });

    await turnOn("done", { alert: true, sound: true, badge: false });
    app.emit(status("a", "done"));
    await settle();

    expect(Object.keys(app.stateAlerts[0]!).sort()).toEqual(["agent", "alert", "body", "sound", "title"]);
    expect(app.stateAlerts[0]).toMatchObject({ title: "scout", body: "Done" });
  });

  it("u5232c_load_repeat_and_idle_raise_nothing", async () => {
    const { app } = await mountToasts([agent("a", "done", "x", { name: "scout" })], { front: false });

    await turnOn("done", { alert: true, sound: true, badge: true });
    app.emit(status("a", "done"));
    app.emit(status("a", "idle"));
    await settle();

    expect(app.stateAlerts).toEqual([]);
  });

  it("u5232d_the_selected_agent_in_front_raises_nothing", async () => {
    const { app, sounds } = await mountToasts(tree(), { selected: "a", front: true });

    await turnOn("done", { alert: true, sound: true, badge: false });
    app.emit(status("a", "done"));
    app.emit(status("b", "done"));
    await settle();

    expect(app.stateAlerts).toEqual([{ agent: "b", title: "mason", body: "Done", alert: false, sound: true }]);
    expect(sounds).toEqual([]);
  });

  it("u5232d_alert_only_while_away", async () => {
    const { app, setFront } = await mountToasts(tree(), { front: true });

    await turnOn("done", { alert: true, sound: true, badge: false });
    app.emit(status("a", "done"));
    await settle();
    setFront(false);
    app.emit(status("b", "done"));
    await settle();

    expect(app.stateAlerts.map(each => each.alert)).toEqual([false, true]);
  });

  it("u5232d_one_alert_and_one_sound_per_agent_per_five_seconds", async () => {
    const { app } = await mountToasts(tree(), { front: false });

    await turnOn("done", { alert: true, sound: true, badge: false });
    await turnOn("working", { alert: true, sound: true, badge: false });
    app.emit(status("a", "done"));
    await vi.advanceTimersByTimeAsync(2000);
    app.emit(status("a", "working"));
    await settle();
    expect(app.stateAlerts).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3500);
    app.emit(status("a", "done"));
    await settle();
    expect(app.stateAlerts).toHaveLength(2);
  });

  it("u5232d_another_agent_is_not_limited", async () => {
    const { app } = await mountToasts(tree(), { front: false });

    await turnOn("done", { alert: true, sound: true, badge: false });
    app.emit(status("a", "done"));
    app.emit(status("b", "done"));
    await settle();

    expect(app.stateAlerts).toHaveLength(2);
  });

  it("u5232c_needs_you_sound_follows_its_choice", async () => {
    const { app, sounds } = await mountToasts(tree(), { front: true });

    await turnOn("needs-you", { alert: false, sound: false, badge: true });
    app.emit(status("a", "needs-you"));
    await settle();

    expect(sounds).toEqual([]);
    expect(app.stateAlerts).toEqual([]);
  });

  it("u5232g_the_webview_shows_a_refusal_once", async () => {
    const { app, alertFailures } = await mountToasts(tree(), { front: false });

    app.stateAlertFailure = new RpcError(-32000, "notifications denied in System Settings");
    await turnOn("done", { alert: true, sound: false, badge: false });
    app.emit(status("a", "done"));
    app.emit(status("b", "done"));
    await settle();

    expect(alertFailures).toEqual(["notifications denied in System Settings", "notifications denied in System Settings"]);
  });

  it("u5232h_only_a_kind_change_calls_state_alert", async () => {
    const { app } = await mountToasts(tree(), { front: false });

    await turnOn("done", { alert: true, sound: true, badge: true });
    app.emit(by({ kind: "agent", id: "a", parent: null }, { name: "todo.deleted", data: { id: 1 } }));
    app.emit(by({ kind: "agent", id: "a", parent: null }, { name: "pad.deleted", data: { name: "n" } }));
    await settle();

    expect(app.stateAlerts).toEqual([]);
  });

  it("u5232h_deletion_raises_no_alert", async () => {
    const { app } = await mountToasts(tree(), { front: false });

    for (const state of ["working", "blocked", "needs-you", "error", "done"]) await turnOn(state, { alert: true, sound: true, badge: true });
    app.handlers["rail.tree"] = () => [agent("b", "idle", "x", { name: "mason" })];
    app.emit(by({ kind: "user", id: "you", parent: null }, { name: "rail.changed" }));
    await settle();

    expect(app.stateAlerts).toEqual([]);
  });

  it("u5232h_native_attention_still_opens_the_requesting_terminal", async () => {
    const { app, connected, toasts } = await mountToasts(tree(), { front: true, selected: "b" });

    app.emit(status("a", "needs-you"));
    await settle();
    fireEvent.click(toasts()[0]!);
    await settle();

    expect(connected.rail.selected()).toBe("a");
    expect(app.stateAlerts).toEqual([]);
  });
});
