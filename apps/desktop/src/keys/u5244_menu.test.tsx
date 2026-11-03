import { padHandlers } from "../testing/stores";
import { USER } from "../testing/nodes";
import { openPad } from "../pads/padsFixture";
import { showEverythingInApp } from "../testing/showEverything";
import { batch } from "solid-js";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { saveAppSettings } from "../settings/preferences";
import { mountNavigation } from "../testing/navigationFixture";
import { openProjectPage, projectMenu } from "../testing/menuProbe";

afterEach(() => { batch(cleanup); localStorage.clear(); });

const focusAt = async (place: "terminal" | "rail row" | "Shelf row" | "Pad editor") => {
  const mounted = await mountNavigation(false, 0);

  if (place === "terminal") {
    mounted.connected().rail.select("a1");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
  } else if (place === "Shelf row") {
    await showEverythingInApp();
    document.querySelector<HTMLElement>('[data-todo="1"] .todo-row-button[aria-pressed]')!.focus();
  } else if (place === "Pad editor") {
    const pads = [{ name: "Plan", incarnation: "fixture-Plan", text: "", updated_at: 0, revision: 1, home: null }];
    Object.assign(mounted.daemon.handlers, padHandlers({ pads, history: [] }, () => {}));
    mounted.daemon.emit({ actor: USER, name: "pad.changed", data: { name: "Plan" } });
    await showEverythingInApp(undefined, "Pads");
    await openPad("Plan");
    screen.getByLabelText("Pad body", { selector: '[role="textbox"]' }).focus();
  } else document.querySelector<HTMLElement>('[data-part="item"]')!.focus();

  await waitFor(() => expect(projectMenu.items.length).toBeGreaterThan(5));

  return mounted;
};

it.each(["terminal", "rail row", "Shelf row", "Pad editor"] as const)("u5919a_project_menu_has_only_the_ten_actions: %s focus", async place => {
  await focusAt(place);
  expect(projectMenu.items.filter(item => item.group !== "edit").map(item => item.id)).toEqual([
    "action:chord:⌘N", "action:chord:⇧⌘N", "action:chord:⌥⌘N", "action:chord:⇧⌘M", "action:chord:⌘T", "action:chord:⇧⌘T",
    "action:chord:⌃⌘J", "action:leader:C", "action:leader:P", "action:chord:⌘O",
  ]);
});

it("u5244b_unavailable_commands_stay_listed_disabled: attention keeps its position when attention clears", async () => {
  const { daemon } = await focusAt("rail row");
  const id = "action:chord:⌃⌘J";
  await waitFor(() => expect(projectMenu.items.find(item => item.id === id)?.enabled).toBe(true));
  const enabled = projectMenu.items.find(item => item.id === id)!;
  const at = projectMenu.items.findIndex(item => item.id === id);
  daemon.emit({ actor: { kind: "user", id: "you", parent: null }, name: "agent.status", data: { id: "a0", attempt: "1", status_revision: "2", status: { kind: "idle", label: "ready", since: 1, finished: "0" } } });
  await waitFor(() => expect(projectMenu.items.find(item => item.id === id)?.enabled).toBe(false));
  expect(projectMenu.items.find(item => item.id === id)).toEqual({ ...enabled, enabled: false });
  expect(projectMenu.items.findIndex(item => item.id === id)).toBe(at);
});

it("u5244b_choosing_a_disabled_item_runs_nothing", async () => {
  const { daemon } = await focusAt("terminal");
  const id = "action:leader:C";
  expect(projectMenu.items.find(item => item.id === id)?.enabled).toBe(false);
  const focus = document.activeElement;
  const calls = daemon.calls.length;
  openProjectPage(id, "/p");
  expect(daemon.calls).toHaveLength(calls);
  expect(document.activeElement).toBe(focus);
});

it("u5919b_unreachable_daemon_keeps_create_actions_disabled", async () => {
  const { app } = await focusAt("rail row");
  const before = projectMenu.items.filter(item => item.group !== "edit");
  app.exitDaemon({ code: 1 }, "/p");
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:⌘N")?.enabled).toBe(false));
  expect(projectMenu.items.filter(item => item.group !== "edit").map(({ id, label, shortcut }) => ({ id, label, shortcut })))
    .toEqual(before.map(({ id, label, shortcut }) => ({ id, label, shortcut })));
});

it("u5919b_project_sequences_track_the_configured_leader", async () => {
  expect(await saveAppSettings({ quickAdd: "ctrl+shift+KeyY", shortcuts: { "leader.open": "meta+shift+KeyT" } })).toBeNull();
  await mountNavigation(false, 1);
  await waitFor(() => expect(projectMenu.items.filter(item => item.id.startsWith("action:leader:")).map(item => item.shortcut)).toEqual(["⇧⌘T C", "⇧⌘T P"]));

  const row = document.querySelector<HTMLElement>('[data-part="item"]')!;
  row.focus();
  fireEvent.keyDown(row, { key: "T", code: "KeyT", metaKey: true, shiftKey: true });
  fireEvent.keyDown(row, { key: "p", code: "KeyP" });
  expect(document.activeElement).toBe(await screen.findByRole("combobox", { name: "Switch Project" }));
});
