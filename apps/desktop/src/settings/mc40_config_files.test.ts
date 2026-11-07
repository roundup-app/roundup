import { afterEach, expect, it } from "vitest";
import { CHORDS } from "../keys/chords";
import { refuseKeys } from "./configApply";
import { lookColours, setByFile, setFileKeys, setFileLook } from "./configFile";
import { appSettings, saveAppSettings, storedSettings } from "./preferences";

afterEach(async () => { setFileLook({}); setFileKeys({}); await saveAppSettings({ quickAdd: "meta+shift+KeyT" }); });

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
