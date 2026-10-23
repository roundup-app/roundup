import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u3799_the_event_and_cmd_comma_open_app_settings_in_the_center_with_four_groups", async () => {
  render(() => <App app={createFakeApp()} reducedMotion={() => true} clock={Date.now} />);
  await screen.findByRole("button", { name: /Choose/ });
  fireEvent.keyDown(window, { key: ",", code: "Comma", metaKey: true });
  const view = await screen.findByRole("region", { name: "Settings" });
  expect(within(screen.getByRole("region", { name: "Centre" })).getByRole("region", { name: "Settings" })).toBe(view);
  expect(within(view).getAllByRole("region").map(item => item.getAttribute("aria-label"))).toEqual(["Agents", "Terminal", "Shortcuts", "Appearance"]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Engine / })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Model / })).toBeNull();
  fireEvent.keyDown(window, { key: ",", code: "Comma", metaKey: true });
  expect(screen.getAllByRole("region", { name: "Settings" })).toHaveLength(1);
});

it("u3800_close_returns_the_center_and_focus", async () => {
  render(() => <App app={createFakeApp()} reducedMotion={() => true} clock={Date.now} />);
  const opener = await screen.findByRole("button", { name: /Choose/ });
  opener.focus();
  window.dispatchEvent(new Event("open-app-settings"));
  const view = await screen.findByRole("region", { name: "Settings" });
  fireEvent.keyDown(view, { key: "Escape", code: "Escape" });
  expect(screen.queryByRole("region", { name: "Settings" })).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(screen.getByRole("button", { name: /Choose/ })).toBe(opener);
  fireEvent.keyDown(opener, { key: ",", code: "Comma", metaKey: true });
  await screen.findByRole("region", { name: "Settings" });
  fireEvent.click(within(screen.getByRole("region", { name: "Settings" })).getByRole("button", { name: "Close" }));
  expect(document.activeElement).toBe(opener);
});

it.each([["KeyY", "y", "⌃⇧Y"], ["Numpad1", "1", "⌃⇧1"], ["F13", "F13", "⌃⇧F13"]])("u3804_a_new_chord_opens_the_field_and_help_lists_it_%s", async (code, key, label) => {
  const { seedApp } = await import("../testing/seeds");
  const { HELP_ROWS } = await import("../keys/chords");
  const { copy } = await import("../copy");
  const controls = seedApp("tree-40", Date.now());
  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  await screen.findAllByRole("treeitem");
  window.dispatchEvent(new Event("open-app-settings"));
  fireEvent.click(await screen.findByRole("button", { name: "Quick add a Todo ⇧⌘T" }));
  expect(screen.getByRole("button", { name: "Quick add a Todo Press a shortcut" })).toBeTruthy();
  fireEvent.keyDown(window, { key, code, ctrlKey: true, shiftKey: true });
  fireEvent.click(within(screen.getByRole("region", { name: "Settings" })).getByRole("button", { name: "Close" }));
  fireEvent.keyDown(window, { key: "T", code: "KeyT", metaKey: true, shiftKey: true });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.keyDown(window, { key, code, ctrlKey: true, shiftKey: true });
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(HELP_ROWS.findLast(row => row.what === copy.captureATodo)?.keys).toBe(label);
});
