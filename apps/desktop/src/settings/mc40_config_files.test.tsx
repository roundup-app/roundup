import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import { CHORDS } from "../keys/chords";
import { refuseKeys } from "./configApply";
import { lookColours, setByFile, setFileKeys, setFileLook } from "./configFile";
import { copy } from "./copy";
import { appSettings, saveAppSettings, storedSettings } from "./preferences";

afterEach(async () => { cleanup(); setFileLook({}); setFileKeys({}); await saveAppSettings({ quickAdd: "meta+shift+KeyT" }); });

it("mc40_saved_look_applies_without_restart", () => {
  const chosen = appSettings().mode;

  setFileLook({ mode: "light", fontSize: "14", "color.accent": "#112233" });

  expect(appSettings()).toMatchObject({ mode: "light", fontSize: 14 });
  expect(lookColours()).toEqual({ "--accent": "#112233" });
  expect(setByFile("mode")).toBe(true);
  expect(setByFile("interfaceScale")).toBe(false);
  expect(storedSettings().mode).toBe(chosen);
});

it("mc40_deleting_the_file_restores_defaults", () => {
  const before = appSettings();

  setFileLook({ mode: "light", interfaceScale: "large" });
  setFileLook({});

  expect(appSettings()).toEqual(before);
  expect(lookColours()).toEqual({});
});

it("mc41_saved_keys_apply_without_restart", () => {
  const before = [...CHORDS["todo.add"].presses];

  setFileKeys({ "todo.add": "meta+shift+KeyT" });

  expect(CHORDS["todo.add"].presses).toEqual(["meta+shift+KeyT"]);
  expect(appSettings().shortcuts).toEqual({ "todo.add": "meta+shift+KeyT" });
  expect(storedSettings().shortcuts).toEqual({});

  setFileKeys({});

  expect(CHORDS["todo.add"].presses).toEqual(before);
});

it("mc41_unknown_name_or_bad_press_refuses_the_file", async () => {
  // U5239d: a press the App owns is free once quick add moves off it.
  await saveAppSettings({ quickAdd: "meta+shift+KeyY" });
  expect(refuseKeys({ "todo.add": "meta+shift+KeyT" })).toBeNull();
  expect(refuseKeys({ "no.such.action": "meta+KeyN" })).toMatch(/^no\.such\.action/);
  // another action's key
  expect(refuseKeys({ "todo.add": "meta+KeyK" })).toMatch(/^todo\.add/);
});

it("mc41_terminal_keys_stay_with_the_terminal", () => {
  expect(refuseKeys({ "todo.add": "ctrl+KeyC" })).toMatch(/^todo\.add/);
  expect(refuseKeys({ "todo.add": "meta+KeyQ" })).toMatch(/^todo\.add/);
});

it("mc40_a_token_the_file_names_shows_read_only_in_app_settings", async () => {
  setFileLook({ mode: "light", interfaceScale: "large", fontFamily: "Menlo", fontSize: "14" });
  render(() => <App app={createFakeApp()} reducedMotion={() => true} clock={Date.now} />);
  await screen.findByRole("button", { name: /Choose/ });
  fireEvent.keyDown(window, { key: ",", code: "Comma", metaKey: true });
  const view = await screen.findByRole("region", { name: "Settings" });
  fireEvent.click(within(view).getByRole("tab", { name: "Terminal" }));

  expect((await within(view).findByRole<HTMLInputElement>("spinbutton", { name: "Font size" })).disabled).toBe(true);
  expect(within(view).getByRole<HTMLButtonElement>("combobox", { name: "Font family" }).disabled).toBe(true);
  expect(within(view).getAllByText(/look\.json/).length).toBeGreaterThanOrEqual(2);

  fireEvent.click(within(view).getByRole("tab", { name: "Appearance" }));

  for (const label of [copy.settingsAppearance, copy.interfaceScale]) {
    const radios = within(await within(view).findByRole("radiogroup", { name: label }, { timeout: 5000 })).getAllByRole<HTMLInputElement>("radio");

    for (const radio of radios) expect(radio.disabled).toBe(true);
  }
});
