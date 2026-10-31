import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import * as xterm from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { App } from "../App";
import { AppSettings } from "./AppSettings";
import { appSettings, saveAppSettings } from "./preferences";
import { createFakeApp } from "../testing/fakeApp";
import { RpcError } from "../app/seam";
import { CHORDS, HELP_ROWS } from "../keys/chords";
import { copy } from "./copy";

beforeEach(() => {
  vi.spyOn(Terminal.prototype, "open").mockImplementation(() => {});
  vi.spyOn(FitAddon.prototype, "fit").mockImplementation(() => {});
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

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
  if (label === "Appearance") {
    await section("Appearance");
    fireEvent.click(screen.getByRole("radio", { name: value }));
    await waitFor(() => expect(appSettings().mode).toBe(value.toLowerCase()));

    return;
  }

  await section("Agents");
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

  if (label === "Font family") {
    fireEvent.click(screen.getByRole("combobox", { name: label }));
    fireEvent.click(await screen.findByRole("option", { name: text }));
    await waitFor(() => expect(appSettings().fontFamily).toBe(text));

    return;
  }

  const field = await screen.findByRole("spinbutton", { name: label });
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
  expect((await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Font size" })).value).toBe("16");
});

it("u3806_an_invalid_field_falls_back_alone", async () => {
  localStorage.setItem("roundup:app-settings", JSON.stringify({ fontSize: 1000, lineHeight: 10, letterSpacing: 2, fontWeight: 42, interfaceScale: "bad", focusMarkers: false, mode: "light", fontFamily: "Menlo", permissionMode: "plan", engine: 12, model: "kept", quickAdd: "x" }));
  await mount();
  expect(appSettings()).toMatchObject({ mode: "light", fontFamily: "Menlo", permissionMode: "plan", engine: "", model: "kept", quickAdd: "meta+shift+KeyT", lineHeight: 1.7, letterSpacing: 2, fontWeight: 300, interfaceScale: "default", focusMarkers: false });
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

it.each(["Font size", "Line height", "Letter spacing"])("u3806_unsubmitted_fields_survive_close_and_reload_without_applying %s", async label => {
  await mount();
  await commit("Font size", "17");
  fireEvent.input(screen.getByRole("spinbutton", { name: label }), { target: { value: "too big" } });
  await waitFor(() => expect(JSON.parse(localStorage.getItem("roundup:drafts:app-settings")!).drafts).toContainEqual(expect.objectContaining({ value: expect.objectContaining({ text: "too big" }) })));
  fireEvent.click(screen.getByRole("button", { name: "← Back" }));
  cleanup();
  await mount();
  await section("Terminal");
  expect((await screen.findByRole<HTMLInputElement>("spinbutton", { name: label })).value).toBe("too big");
  expect(appSettings().fontSize).toBe(17);
});


it("u4686d_controls_have_labels_and_descriptions", async () => {
  await mount();

  for (const [page, controls] of [
    ["Agents", [["combobox", "Permission mode"], ["button", /^Engine /], ["button", /^Model /]]],
    ["Terminal", [["combobox", "Font family"], ["spinbutton", "Font size"]]],
    ["Shortcuts", [["button", /^Quick add a Todo /]]],

  ] as const) {
    await section(page);

    for (const [role, name] of controls) expect(await screen.findByRole(role, { name, description: /\S/ })).toBeTruthy();
  }
});

it("u4687a_mode_segments_keep_scheme_behavior", async () => {
  await mount();
  await section("Appearance");
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "System" }).checked).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
  await waitFor(() => expect(appSettings().mode).toBe("dark"));
});


it("u4687a_family_and_weight_choices_keep_existing_values", async () => {
  await saveAppSettings({ fontFamily: "Uninstalled custom face" });
  await mount();
  await section("Terminal");
  fireEvent.click(screen.getByRole("combobox", { name: "Font family" }));
  fireEvent.click(await screen.findByRole("option", { name: "Uninstalled custom face" }));
  expect(appSettings().fontFamily).toBe("Uninstalled custom face");
  fireEvent.click(screen.getByRole("radio", { name: "500" }));
  await waitFor(() => expect(appSettings().fontWeight).toBe(500));
});

it("u4687a_interface_scale_is_independent_of_terminal_type", async () => {
  await saveAppSettings({ fontSize: 16, lineHeight: 1.4, letterSpacing: 1, fontWeight: 400 });
  await mount();
  await section("Appearance");
  fireEvent.click(screen.getByRole("radio", { name: "Large" }));
  await waitFor(() => expect(appSettings().interfaceScale).toBe("large"));
  expect(appSettings()).toMatchObject({ fontSize: 16, lineHeight: 1.4, letterSpacing: 1, fontWeight: 400 });
});

it.each([["Line height", "lineHeight", "1", "2"], ["Letter spacing", "letterSpacing", "0", "3"]] as const)(
  "u4687a_numeric_controls_commit_endpoints_and_refuse_invalid_drafts %s", async (label, name, min, max) => {
    await mount();
    await section("Terminal");
    const input = await screen.findByRole<HTMLInputElement>("spinbutton", { name: label });

    for (const value of [min, max]) {
      fireEvent.input(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(appSettings()[name]).toBe(Number(value)));
    }

    for (const value of ["", "NaN", "Infinity", "-1", "999"]) {
      fireEvent.input(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(await screen.findByText(new RegExp(label + " must be"))).toBeTruthy();
      expect(input.value).toBe(value);
      expect(appSettings()[name]).toBe(Number(max));
    }
});

it("u4687d_marker_visibility_is_saved_and_shared", async () => {
  await mount();
  await section("Appearance");
  fireEvent.click(screen.getByRole("switch", { name: "Show region focus markers" }));
  await waitFor(() => expect(appSettings().focusMarkers).toBe(false));
  cleanup();
  await mount();
  await section("Appearance");
  expect(screen.getByRole("switch", { name: "Show region focus markers" }).getAttribute("aria-checked")).toBe("false");
});

it("u4687b_preview_follows_valid_drafts_without_committing", async () => {
  const renderer = vi.spyOn(xterm, "Terminal");
  const app = await mount();
  await section("Terminal");
  const input = await screen.findByRole("spinbutton", { name: "Line height" });
  await screen.findByRole("region", { name: "Terminal preview" });
  const preview = renderer.mock.instances.at(-1)!;
  fireEvent.input(input, { target: { value: "1.2" } });
  await waitFor(() => expect(preview.options.lineHeight).toBe(1.2));
  expect(appSettings().lineHeight).toBe(1.7);
  fireEvent.input(input, { target: { value: "invalid" } });
  expect(preview.options.lineHeight).toBe(1.2);
  expect(appSettings().lineHeight).toBe(1.7);
  expect(app.calls.filter(call => call.method.startsWith("terminal.") || call.method === "agent.spawn")).toEqual([]);
});

it("u4687b_preview_never_creates_or_writes_a_terminal", async () => {
  const app = await mount();
  await section("Terminal");
  await screen.findByRole("region", { name: "Terminal preview" });
  fireEvent.click(screen.getByRole("radio", { name: "600" }));
  await waitFor(() => expect(appSettings().fontWeight).toBe(600));
  expect(app.calls.filter(call => call.method.startsWith("terminal.") || call.method === "agent.spawn")).toEqual([]);
  expect(app.outputSubscriptions).toEqual([]);
});

it("u4687c_unfinished_settings_survive_external_changes", async () => {
  await mount();
  await section("Terminal");
  const input = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Line height" });
  fireEvent.input(input, { target: { value: " 1.25 " } });
  await saveAppSettings({ lineHeight: 1.5 });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe(" 1.25 ");
  expect(appSettings().lineHeight).toBe(1.5);
  expect(screen.getAllByText(/Settings changed elsewhere/).length).toBeGreaterThan(0);
});

it("u4687c_a_failed_save_keeps_its_revision_and_a_newer_edit", async () => {
  await mount();
  await section("Terminal");
  const input = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Line height" });
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "roundup:app-settings") throw new Error("Cannot save settings; free disk space and retry.");

    return setItem.call(this, key, value);
  });
  fireEvent.input(input, { target: { value: "1.25" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByText(/Cannot save settings/);
  fireEvent.input(input, { target: { value: "newer exact edit" } });
  await waitFor(() => {
    const drafts = JSON.parse(localStorage.getItem("roundup:drafts:app-settings")!).drafts;
    expect(drafts).toContainEqual(expect.objectContaining({ status: "failed", value: expect.objectContaining({ text: "1.25" }) }));
    expect(drafts).toContainEqual(expect.objectContaining({ status: "draft", value: expect.objectContaining({ text: "newer exact edit" }) }));
  });
  expect(appSettings().lineHeight).toBe(1.7);
});

it("u4687c_saved_changes_reach_other_project_tabs", async () => {
  await mount();
  const other = createFakeApp();
  render(() => <AppSettings app={other} project={() => "/other"} />);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));

  for (const tab of await screen.findAllByRole("tab", { name: "Terminal" })) fireEvent.click(tab);
  const choices = await screen.findAllByRole<HTMLInputElement>("radio", { name: "500" });
  fireEvent.click(choices[0]!);
  await waitFor(() => expect(choices.every(choice => choice.checked)).toBe(true));
  cleanup();
  await mount();
  await section("Terminal");
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "500" }).checked).toBe(true);
});

const portWith = (configure: (press: string | null) => Promise<void>): import("../app/seam").CapturePort => ({
  configure, show: async () => {}, dismiss: async () => {}, publish: async () => {}, act: async () => {},
  onRequested: async () => () => {}, onAction: async () => () => {}, onState: async () => () => {},
});

it("u5205_default_settings_call_configure_with_no_chord_and_cmd_shift_t_opens_quick_add", async () => {
  const app = createFakeApp();
  app.add("/p");
  const configure = vi.fn(async (_press: string | null) => {});
  const port = portWith(configure);
  const show = vi.spyOn(port, "show");
  app.capture = port;
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await waitFor(() => expect(configure).toHaveBeenCalledWith(null));
  expect(configure.mock.calls.filter(([chord]) => chord !== null)).toEqual([]);
  fireEvent.keyDown(window, { key: "T", code: "KeyT", metaKey: true, shiftKey: true });
  await waitFor(() => expect(show).toHaveBeenCalled());
});

it("u5205_a_mac_wide_chord_calls_configure_and_reset_returns_none", async () => {
  const app = await mount();
  const configure = vi.fn(async (_press: string | null) => {});
  cleanup();
  render(() => <AppSettings app={Object.assign(app, { capture: portWith(configure) })} project={() => "/p"} />);
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByRole("region", { name: "Settings" });
  await section("Shortcuts");
  const row = screen.getByRole("button", { name: /^Quick add from any app / });
  fireEvent.click(row);
  fireEvent.keyDown(window, { key: "y", code: "KeyY", ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(appSettings().quickAddAnywhere).toBe("ctrl+shift+KeyY"));
  expect(configure).toHaveBeenLastCalledWith("ctrl+shift+KeyY");
  expect(appSettings().quickAdd).toBe("meta+shift+KeyT");
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(appSettings().quickAddAnywhere).toBe(""));
  expect(configure).toHaveBeenLastCalledWith(null);
  expect(appSettings().quickAdd).toBe("meta+shift+KeyT");
});

it("u5205_no_default_setting_registers_a_global_shortcut", () => {
  expect(appSettings().quickAddAnywhere || null).toBeNull();
});
