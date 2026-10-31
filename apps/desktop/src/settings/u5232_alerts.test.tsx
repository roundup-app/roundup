import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { AppSettings } from "./AppSettings";
import { appSettings, saveAppSettings } from "./preferences";
import { createFakeApp } from "../testing/fakeApp";
import { mountRail } from "../rail/railFixture";
import { agent, event } from "../testing/nodes";

afterEach(() => { cleanup(); localStorage.clear(); });

const open = async () => {
  const app = createFakeApp();

  render(() => <AppSettings app={app} project={() => "/p"} />);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByRole("region", { name: "Settings" });
  const tab = screen.getByRole("tab", { name: "Alerts" });

  fireEvent.click(tab);
  await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
};

const toStatus = (id: string, kind: "working" | "needs-you" | "error" | "blocked" | "done") =>
  event({ name: "agent.status", data: { status_revision: "2", attempt: "1", id, status: { kind, label: kind, since: 1, finished: "0" } } });

it("u5232a_defaults_equal_todays_behaviour", () => {
  const { stateAlerts } = appSettings();

  expect(Object.entries(stateAlerts).flatMap(([state, row]) => Object.entries(row).filter(([, on]) => on).map(([choice]) => `${state} ${choice}`)).sort())
    .toEqual(["error badge", "error sound", "needs-you badge", "needs-you sound"]);
});

it("u5232b_the_group_lists_five_states_with_three_switches", async () => {
  await open();

  const groups = await screen.findAllByRole("group");
  const states = groups.map(group => group.getAttribute("aria-label")).filter(label => label !== null);

  expect(states).toEqual(["Working", "Blocked", "Needs you", "Error", "Done"]);
  expect(within(screen.getByRole("group", { name: "Needs you" })).getAllByRole("switch").map(each => each.getAttribute("aria-checked"))).toEqual(["false", "true", "true"]);
  expect(screen.getByRole("switch", { name: "Done Dock badge" })).toBeTruthy();
});

it("u5232b_a_switch_works_by_keyboard", async () => {
  await open();

  const toggle = await screen.findByRole("switch", { name: "Done Alert" });

  toggle.focus();
  fireEvent.click(toggle);
  await waitFor(() => expect(appSettings().stateAlerts.done.alert).toBe(true));
});

it("u5232b_a_change_survives_a_reload_and_reaches_every_tab", async () => {
  await open();
  fireEvent.click(await screen.findByRole("switch", { name: "Working Sound" }));
  await waitFor(() => expect(appSettings().stateAlerts.working.sound).toBe(true));

  expect(JSON.parse(localStorage.getItem("roundup:app-settings")!).stateAlerts.working.sound).toBe(true);
});

it("u5232b_an_invalid_field_falls_back_alone", () => {
  localStorage.setItem("roundup:app-settings", JSON.stringify({ stateAlerts: { done: { alert: "yes", sound: true }, working: 3 } }));

  const { stateAlerts } = appSettings();

  expect(stateAlerts.done).toEqual({ alert: false, sound: true, badge: false });
  expect(stateAlerts.working).toEqual({ alert: false, sound: false, badge: false });
  expect(stateAlerts["needs-you"]).toEqual({ alert: false, sound: true, badge: true });
});

it("u5232c_the_badge_recounts_and_clears_at_zero", async () => {
  const { app, rail } = await mountRail([agent("a", "working", "x"), agent("b", "needs-you", "x")]);

  expect(app.badges.at(-1)).toBe(1);

  const chosen = appSettings().stateAlerts;

  await saveAppSettings({ stateAlerts: { ...chosen, working: { ...chosen.working, badge: true } } });
  await waitFor(() => expect(app.badges.at(-1)).toBe(2));

  await saveAppSettings({ stateAlerts: { ...appSettings().stateAlerts, "needs-you": { ...chosen["needs-you"], badge: false } } });
  await waitFor(() => expect(app.badges.at(-1)).toBe(1));

  app.emit(toStatus("a", "blocked"));
  await rail.settled();
  expect(app.badges.at(-1)).toBe(0);
});
