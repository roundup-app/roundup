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

const section = async (name: string) => {
  const tab = screen.getByRole("tab", { name });
  fireEvent.click(tab);
  await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
};

const select = async (label: string, value: string) => {
  await section(label === "Appearance" ? "Appearance" : "Agents");
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: value }));
};

const pick = async (label: string, value: string) => {
  await section("Agents");
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label} `) }));
  fireEvent.click(await screen.findByRole("option", { name: value }));
  await screen.findByRole("button", { name: `${label} ${value}` });
};

const commit = async (label: string, text: string, valid = true) => {
  await section("Terminal");
  const field = await screen.findByRole(label === "Font size" ? "spinbutton" : "textbox", { name: label });
  fireEvent.input(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });

  if (valid) await waitFor(() => expect(appSettings()[label === "Font size" ? "fontSize" : "fontFamily"]).toBe(label === "Font size" ? Number(text) : text));
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
  await commit("Font size", "17");
  await commit("Font size", invalid, false);
  expect(await screen.findByText(/Choose a font size from/)).toBeTruthy();
  expect(appSettings().fontSize).toBe(17);
  expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "Font size" }).value).toBe(invalid);
});

it("u4547c_settings_choices_do_not_change_the_workstream_prompt", async () => {
  const app = await mount();
  await select("Permission mode", "Plan");
  await pick("Engine", "Engine One");
  await pick("Model", "Model One");
  await commit("Font family", "Menlo");
  await commit("Font size", "16");
  await select("Appearance", "Dark");
  await section("Shortcuts");
  fireEvent.click(screen.getByRole("button", { name: /^Quick add a Todo / }));
  fireEvent.keyDown(window, { key: "y", code: "KeyY", ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(appSettings().quickAdd).toBe("ctrl+shift+KeyY"));
  expect(JSON.parse(localStorage.getItem("roundup:app-settings")!)).toMatchObject({ permissionMode: "plan", engine: "engine-one", model: "model-one", fontFamily: "Menlo", fontSize: 16, mode: "dark", quickAdd: "ctrl+shift+KeyY" });
  expect(app.calls.filter(call => ["workstream.setOpeningPrompt", "workstream.restart", "rail.startDoor"].includes(call.method))).toEqual([]);
  cleanup();
  await mount();
  expect(appSettings()).toMatchObject({ permissionMode: "plan", engine: "engine-one", model: "model-one", fontFamily: "Menlo", fontSize: 16, mode: "dark", quickAdd: "ctrl+shift+KeyY" });
  await section("Terminal");
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Font family" }).value).toBe("Menlo");
  expect((await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Font size" })).value).toBe("16");
});

it("u3806_an_invalid_field_falls_back_alone", async () => {
  localStorage.setItem("roundup:app-settings", JSON.stringify({ fontSize: 1000, mode: "light", fontFamily: "Menlo", permissionMode: "plan", engine: 12, model: "kept", quickAdd: "x" }));
  await mount();
  expect(appSettings()).toMatchObject({ mode: "light", fontFamily: "Menlo", permissionMode: "plan", engine: "", model: "kept", quickAdd: "meta+shift+KeyT" });
  await section("Terminal");
  expect(Number((await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Font size" })).value)).toBeLessThan(22);
  cleanup();
  localStorage.setItem("roundup:app-settings", "not JSON");
  await mount();
  expect(appSettings()).toMatchObject({ mode: "system", permissionMode: "", fontFamily: "", model: "" });
});

it("u3804_a_clashing_chord_is_refused_naming_the_holder", async () => {
  await mount();
  await section("Shortcuts");
  fireEvent.click(screen.getByRole("button", { name: /^Quick add a Todo / }));
  fireEvent.keyDown(window, { key: "n", code: "KeyN", metaKey: true });
  expect(await screen.findByText(/⌘N is already New Agent/)).toBeTruthy();
  fireEvent.keyDown(window, { key: "q", code: "KeyQ", metaKey: true });
  expect(await screen.findByText(/⌘Q is already Quit roundup/)).toBeTruthy();
  expect(appSettings().quickAdd).toBe("meta+shift+KeyT");
  fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
  expect(screen.getByRole("tab", { name: "Shortcuts" }).getAttribute("aria-selected")).toBe("true");
});

it("u3804_reset_restores_the_default", async () => {
  await saveAppSettings({ quickAdd: "ctrl+KeyY" });
  await mount();
  await section("Shortcuts");
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(CHORDS.find(row => row.what === copy.captureATodo)?.presses).toEqual(["meta+shift+KeyT"]));
  expect(HELP_ROWS.findLast(row => row.what === copy.captureATodo)?.keys).toBe("⇧⌘T");
});

it("u3806_unsubmitted_fields_survive_close_and_reload_without_applying", async () => {
  await mount();
  await commit("Font size", "17");
  fireEvent.input(screen.getByRole("spinbutton", { name: "Font size" }), { target: { value: "too big" } });
  await waitFor(() => expect(JSON.parse(localStorage.getItem("roundup:drafts:app-settings")!).drafts).toContainEqual(expect.objectContaining({ value: { text: "too big" } })));
  fireEvent.click(screen.getByRole("button", { name: "← Back" }));
  cleanup();
  await mount();
  await section("Terminal");
  expect((await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Font size" })).value).toBe("too big");
  expect(appSettings().fontSize).toBe(17);
});


it("u4686d_controls_have_labels_and_descriptions", async () => {
  await mount();

  for (const [page, controls] of [
    ["Agents", [["combobox", "Permission mode"], ["button", /^Engine /], ["button", /^Model /]]],
    ["Terminal", [["textbox", "Font family"], ["spinbutton", "Font size"]]],
    ["Shortcuts", [["button", /^Quick add a Todo /]]],
    ["Appearance", [["combobox", "Mode"]]],
  ] as const) {
    await section(page);

    for (const [role, name] of controls) expect(await screen.findByRole(role, { name, description: /\S/ })).toBeTruthy();
  }
});
