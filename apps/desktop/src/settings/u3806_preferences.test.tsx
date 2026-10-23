import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { AppSettings } from "./AppSettings";
import { appSettings, saveAppSettings } from "./preferences";
import { createFakeApp } from "../testing/fakeApp";
import { RpcError } from "../app/seam";
import { CHORDS, HELP_ROWS } from "../keys/chords";
import { copy } from "../copy";

afterEach(() => { cleanup(); localStorage.clear(); });

const mount = async (fail = false) => {
  const app = createFakeApp();
  app.handlers["models.list"] = () => {
    if (fail) throw new RpcError(-32603, "Model list unavailable; reopen Settings to retry.");

    return { engines: [{ id: "engine-one", label: "Engine One" }, { id: "engine-two", label: "Engine Two" }], models: [{ id: "model-one", label: "Model One" }], efforts: [] };
  };

  render(() => <AppSettings app={app} project={() => "/p"} />);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByRole("region", { name: "Settings" });

  return app;
};

const select = async (label: string, value: string) => {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: value }));
};

const pick = async (label: string, value: string) => {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label} `) }));
  fireEvent.click(await screen.findByRole("option", { name: value }));
};

const commit = (label: string, text: string) => {
  const field = screen.getByRole("textbox", { name: label });
  fireEvent.input(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
};

it("u3802_changing_the_engine_resets_a_foreign_model", async () => {
  await mount();
  await pick("Engine", "Engine One");
  await pick("Model", "Model One");
  await pick("Engine", "Engine Two");
  expect(appSettings()).toMatchObject({ engine: "engine-two", model: "" });
});

it("u3802_selecting_the_same_engine_keeps_its_model", async () => {
  await mount();
  await pick("Engine", "Engine One");
  await pick("Model", "Model One");
  await pick("Engine", "Engine One");
  expect(appSettings().model).toBe("model-one");
});

it("u3802_a_failed_list_shows_the_message_and_keeps_the_choice", async () => {
  await mount();
  await pick("Engine", "Engine One");
  await pick("Model", "Model One");
  cleanup();
  await mount(true);
  expect(await screen.findByText(/Model list unavailable; reopen Settings to retry/)).toBeTruthy();
  expect(appSettings()).toMatchObject({ engine: "engine-one", model: "model-one" });
  expect(screen.getByRole("button", { name: "Engine Engine One" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Model Model One" })).toBeTruthy();
});

it.each(["300", "2", "not a number"])("u3803_a_bad_size_is_refused_and_changes_nothing_%s", async invalid => {
  await mount();
  commit("Font size", "17");
  commit("Font size", invalid);
  expect(await screen.findByText(/Choose a font size from/)).toBeTruthy();
  expect(appSettings().fontSize).toBe(17);
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Font size" }).value).toBe(invalid);
});

it("u3806_a_change_survives_a_reload", async () => {
  await mount();
  await select("Permission mode", "Plan");
  await pick("Engine", "Engine One");
  await pick("Model", "Model One");
  commit("Font family", "Menlo");
  commit("Font size", "16");
  await select("Mode", "Dark");
  fireEvent.click(screen.getByRole("button", { name: /^Quick add a Todo / }));
  fireEvent.keyDown(window, { key: "y", code: "KeyY", ctrlKey: true, shiftKey: true });
  expect(JSON.parse(localStorage.getItem("roundup:app-settings")!)).toMatchObject({ permissionMode: "plan", engine: "engine-one", model: "model-one", fontFamily: "Menlo", fontSize: 16, mode: "dark", quickAdd: "ctrl+shift+KeyY" });
  cleanup();
  await mount();
  expect(appSettings()).toMatchObject({ permissionMode: "plan", engine: "engine-one", model: "model-one", fontFamily: "Menlo", fontSize: 16, mode: "dark", quickAdd: "ctrl+shift+KeyY" });
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Font family" }).value).toBe("Menlo");
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Font size" }).value).toBe("16");
});

it("u3806_an_invalid_field_falls_back_alone", async () => {
  localStorage.setItem("roundup:app-settings", JSON.stringify({ fontSize: 1000, mode: "light", fontFamily: "Menlo", permissionMode: "plan", engine: 12, model: "kept", quickAdd: "x" }));
  await mount();
  expect(appSettings()).toMatchObject({ mode: "light", fontFamily: "Menlo", permissionMode: "plan", engine: "", model: "kept", quickAdd: "meta+shift+KeyT" });
  expect(Number(screen.getByRole<HTMLInputElement>("textbox", { name: "Font size" }).value)).toBeLessThan(22);
  cleanup();
  localStorage.setItem("roundup:app-settings", "not JSON");
  await mount();
  expect(appSettings()).toMatchObject({ mode: "system", permissionMode: "", fontFamily: "", model: "" });
});

it("u3804_a_clashing_chord_is_refused_naming_the_holder", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: /^Quick add a Todo / }));
  fireEvent.keyDown(window, { key: "n", code: "KeyN", metaKey: true });
  expect(await screen.findByText(/⌘N is already New Agent/)).toBeTruthy();
  fireEvent.keyDown(window, { key: "q", code: "KeyQ", metaKey: true });
  expect(await screen.findByText(/⌘Q is already Quit roundup/)).toBeTruthy();
  expect(appSettings().quickAdd).toBe("meta+shift+KeyT");
  fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
  expect(screen.getByRole("region", { name: "Settings" })).toBeTruthy();
});

it("u3804_reset_restores_the_default", async () => {
  saveAppSettings({ quickAdd: "ctrl+KeyY" });
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(CHORDS.find(row => row.what === copy.captureATodo)?.presses).toEqual(["meta+shift+KeyT"]));
  expect(HELP_ROWS.findLast(row => row.what === copy.captureATodo)?.keys).toBe("⇧⌘T");
});

it("u3806_unsubmitted_fields_survive_close_and_reload_without_applying", async () => {
  await mount();
  commit("Font size", "17");
  fireEvent.input(screen.getByRole("textbox", { name: "Font size" }), { target: { value: "too big" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Font size" }), { key: "Escape", code: "Escape" });
  cleanup();
  await mount();
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Font size" }).value).toBe("too big");
  expect(appSettings().fontSize).toBe(17);
});
