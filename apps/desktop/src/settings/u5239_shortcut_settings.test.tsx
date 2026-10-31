import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { AppSettings } from "./AppSettings";
import { appSettings, saveAppSettings } from "./preferences";
import { createFakeApp } from "../testing/fakeApp";
import { ACTION_ROWS, CHORDS, HELP_ROWS, type Chord } from "../keys/chords";
import { copy } from "./copy";

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await saveAppSettings({ shortcuts: {}, quickAdd: "meta+shift+KeyT" }); localStorage.clear(); });

const mount = async () => {
  vi.spyOn(Terminal.prototype, "open").mockImplementation(() => {});
  vi.spyOn(FitAddon.prototype, "fit").mockImplementation(() => {});

  const app = createFakeApp();

  render(() => <AppSettings app={app} project={() => "/p"} />);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  const view = within(await screen.findByRole("region", { name: "Settings" }));
  fireEvent.click(view.getByRole("tab", { name: "Shortcuts" }));
  await view.findByRole("button", { name: copy.findKey });

  return { app, view };
};

const chord = (name: string) => CHORDS.find(row => row.name === name)!;
const press = (code: string, mods: KeyboardEventInit) => fireEvent.keyDown(window, { code, key: code.replace(/^Key/, "").toLowerCase(), ...mods });
const rowOf = (view: ReturnType<typeof within>, name: string) => view.getByRole("button", { name: new RegExp(`^${chord(name).what}`) });
const freeTShift = () => saveAppSettings({ quickAdd: "meta+shift+KeyY" });

it("u5239a_one_row_per_named_action_with_its_label_and_keys", async () => {
  const { view } = await mount();
  const labels = [...document.querySelectorAll(".settings-field-caption")].map(node => node.textContent);

  expect(labels).toEqual(ACTION_ROWS.flatMap(row => row.name === "todo.capture" ? [copy.quickAddTodo, copy.quickAddAnywhere] : [row.what]));
  expect(view.getByRole("button", { name: /^Quick add a Todo/ })).toBeTruthy();
  expect(rowOf(view, "agent.new").textContent).toContain("⌘N");
});

it("u5239a_a_new_table_entry_gets_a_row", async () => {
  const added = { name: "test.added", keys: "⌘9", what: "Added by a test", presses: [] } satisfies Chord;
  (CHORDS as Chord[]).push(added);
  (ACTION_ROWS as Chord[]).push(added);

  try {
    await mount();
    expect([...document.querySelectorAll(".settings-field-caption")].map(node => node.textContent)).toContain("Added by a test");
  } finally {
    (CHORDS as Chord[]).pop();
    (ACTION_ROWS as Chord[]).pop();
  }
});

it("u5239b_a_recorded_key_runs_the_action_at_once_and_after_reload", async () => {
  await freeTShift();
  const { view } = await mount();

  fireEvent.click(rowOf(view, "terminal.new"));
  press("KeyT", { metaKey: true, shiftKey: true });
  await waitFor(() => expect(appSettings().shortcuts).toEqual({ "terminal.new": "meta+shift+KeyT" }));
  expect(chord("terminal.new").presses).toEqual(["meta+shift+KeyT"]);
  expect(HELP_ROWS.find(row => row.what === chord("terminal.new").what)?.keys).toBe("⇧⌘T");
  expect(JSON.parse(localStorage.getItem("roundup:app-settings")!).shortcuts).toEqual({ "terminal.new": "meta+shift+KeyT" });
});

it("u5239b_a_clash_or_reserved_chord_is_refused_naming_the_holder", async () => {
  const { view } = await mount();

  fireEvent.click(rowOf(view, "terminal.new"));
  press("KeyN", { metaKey: true });
  expect(await view.findByText(copy.shortcutRefusal("⌘N", chord("agent.new").what))).toBeTruthy();
  press("KeyQ", { metaKey: true });
  expect(await view.findByText(copy.shortcutRefusal("⌘Q", copy.quitApp))).toBeTruthy();
  press("KeyY", {});
  expect(await view.findByText(copy.shortcutModifier)).toBeTruthy();
  expect(appSettings().shortcuts).toEqual({});
});

it("u5239b_escape_cancels_and_reset_restores_the_default", async () => {
  await freeTShift();
  const { view } = await mount();

  fireEvent.click(rowOf(view, "terminal.new"));
  press("Escape", {});
  expect(rowOf(view, "terminal.new").getAttribute("aria-pressed")).toBe("false");
  expect(view.queryByRole("button", { name: copy.reset })).toBeNull();
  fireEvent.click(rowOf(view, "terminal.new"));
  press("KeyT", { metaKey: true, shiftKey: true });
  fireEvent.click(await view.findByRole("button", { name: copy.reset }));
  await waitFor(() => expect(appSettings().shortcuts).toEqual({}));
  expect(chord("terminal.new").presses).toEqual(["meta+KeyT"]);
});

it("u5239c_a_pressed_key_names_its_action_or_says_free", async () => {
  const { view } = await mount();

  fireEvent.click(view.getByRole("button", { name: copy.findKey }));
  press("KeyN", { metaKey: true });
  expect(await view.findByText(copy.chordIs("⌘N", chord("agent.new").what))).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: copy.findKey }));
  press("KeyY", { metaKey: true });
  expect(await view.findByText(copy.chordFree("⌘Y"))).toBeTruthy();
});

it("u5239c_the_lookup_runs_nothing_and_saves_nothing", async () => {
  const { app, view } = await mount();
  const before = JSON.stringify(appSettings());
  const sent = app.calls.length;

  fireEvent.click(view.getByRole("button", { name: copy.findKey }));
  press("KeyN", { metaKey: true });
  await view.findByText(copy.chordIs("⌘N", chord("agent.new").what));
  expect(app.calls).toHaveLength(sent);
  expect(JSON.stringify(appSettings())).toBe(before);
  fireEvent.click(view.getByRole("button", { name: copy.findKey }));
  press("Escape", {});
  expect(view.getByRole("button", { name: copy.findKey }).getAttribute("aria-pressed")).toBe("false");
});

it("u5239d_a_chord_a_terminal_needs_is_refused", async () => {
  const { view } = await mount();

  for (const [code, mods, label] of [["KeyV", { metaKey: true }, "⌘V"], ["KeyY", { ctrlKey: true }, "⌃Y"], ["KeyY", { altKey: true, metaKey: true }, "⌥⌘Y"]] as const) {
    fireEvent.click(rowOf(view, "terminal.new"));
    press(code, mods);
    expect(await view.findByText(copy.shortcutTerminal(label))).toBeTruthy();
  }

  expect(appSettings().shortcuts).toEqual({});
});

it("u5239d_the_terminal_sweep_holds_with_overrides", async () => {
  await freeTShift();
  const { view } = await mount();

  fireEvent.click(rowOf(view, "terminal.new"));
  press("KeyT", { metaKey: true, shiftKey: true });
  await waitFor(() => expect(appSettings().shortcuts["terminal.new"]).toBe("meta+shift+KeyT"));

  const appScope = CHORDS.filter(row => !row.inFirstRun && !row.inRail && !row.inTerminals && !row.inShelf && !row.inEditor).flatMap(row => row.presses);

  expect(appScope).toContain("meta+shift+KeyT");
  expect(appScope).not.toContain("meta+KeyT");
  expect(appScope.filter(each => /ctrl|alt|meta/.test(each) && !/^(meta\+(shift\+)?Key[NTKMZ]|alt\+meta\+KeyN|ctrl\+meta\+KeyJ|meta\+(Slash|Comma))$/.test(each))).toEqual([]);
});

it("u5239e_the_file_holds_exactly_the_overrides", async () => {
  await freeTShift();
  await saveAppSettings({ shortcuts: { "terminal.new": "meta+shift+KeyT" } });
  const { app, view } = await mount();

  app.chooser.savePath = "/tmp/shortcuts.json";
  app.handlers["shortcuts.export"] = () => null;
  fireEvent.click(view.getByRole("button", { name: copy.saveToFile }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "shortcuts.export")).toEqual([{ method: "shortcuts.export", params: { path: "/tmp/shortcuts.json", overrides: { "terminal.new": "meta+shift+KeyT" } } }]));
  expect(app.chooser.suggestedNames).toEqual(["shortcuts.json"]);
});

it("u5239e_cancel_writes_nothing_and_no_override_disables_the_control", async () => {
  const { app, view } = await mount();

  expect((view.getByRole("button", { name: copy.saveToFile }) as HTMLButtonElement).disabled).toBe(true);
  await saveAppSettings({ shortcuts: { "terminal.new": "meta+shift+KeyT" } });
  await waitFor(() => expect((view.getByRole("button", { name: copy.saveToFile }) as HTMLButtonElement).disabled).toBe(false));
  app.chooser.savePath = null;
  fireEvent.click(view.getByRole("button", { name: copy.saveToFile }));
  await waitFor(() => expect(app.chooser.suggestedNames).toEqual(["shortcuts.json"]));
  expect(app.calls.some(call => call.method === "shortcuts.export")).toBe(false);
});

it("u5239e_a_failed_write_shows_its_cause", async () => {
  await saveAppSettings({ shortcuts: { "terminal.new": "meta+shift+KeyT" } });
  const { app, view } = await mount();

  app.chooser.savePath = "/nope/shortcuts.json";
  app.handlers["shortcuts.export"] = () => { throw new Error("cannot export to /nope/shortcuts.json: denied"); };
  fireEvent.click(view.getByRole("button", { name: copy.saveToFile }));
  expect(await screen.findByText(/cannot export to \/nope\/shortcuts.json: denied/)).toBeTruthy();
});
