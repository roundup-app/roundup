import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { batch, createRoot, createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";
import { openProjectPage } from "../testing/menuProbe";
import { showEverythingInApp } from "../testing/showEverything";
import { agent, info, USER, workstream } from "../testing/nodes";
import { padHandlers } from "../testing/stores";
import { openPad } from "../pads/padsFixture";
import { CHORDS } from "./chords";
import { saveAppSettings } from "../settings/preferences";
import { captureActions, registerKeys } from "./registry";

const disposals: (() => void)[] = [];

afterEach(() => { disposals.splice(0).forEach(dispose => dispose()); batch(cleanup); localStorage.clear(); });

const owner = (terminal: HTMLElement) => {
  const calls: Element[] = [];
  const [available, setAvailable] = createSignal(true);
  let remove = () => {};

  createRoot(dispose => {
    remove = dispose;
    disposals.push(dispose);
    registerKeys({ kind: "region", element: () => terminal }, [{
      action: CHORDS.find(action => action.keys === "⌘F")!,
      capture: focus => ({
        available: () => available() && !!focus && terminal.contains(focus),
        invoke: () => { calls.push(focus!); },
      }),
    }]);
  });

  return { calls, setAvailable, remove };
};

it("u3787b_menu_and_key_share_one_action: Terminal Find from key", async () => {
  const { connected, daemon } = await mountNavigation(false, 0);
  connected().rail.select("a1");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
  const terminal = document.activeElement;

  if (!(terminal instanceof HTMLElement)) throw new Error("Terminal did not receive focus");

  const inactive = owner(document.createElement("div"));
  const find = owner(terminal);
  const writes = daemon.calls.filter(call => call.method === "terminal.write").length;
  expect(document.activeElement).toBe(terminal);
  expect(find.calls).toEqual([]);

  fireEvent.keyDown(terminal, { code: "KeyF", key: "f", metaKey: true });

  expect(find.calls).toEqual([terminal]);
  expect(inactive.calls).toEqual([]);
  expect(document.activeElement).toBe(terminal);
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toHaveLength(writes);
});

it.each(["unavailable", "removed", "editor"])("u3787b_scoped_menu_does_not_steal_terminal_input: %s Find owner", async state => {
  const { connected } = await mountNavigation(false, 0);
  connected().rail.select("a1");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
  const terminal = document.activeElement;

  if (!(terminal instanceof HTMLElement)) throw new Error("Terminal did not receive focus");

  const find = owner(terminal);
  const captured = captureActions(terminal).find(action => action.keys === "⌘F")!;

  if (state === "unavailable") find.setAvailable(false);
  else if (state === "removed") find.remove();
  else {
    const editor = document.createElement("textarea");
    document.body.append(editor);
    editor.focus();
    expect(fireEvent.keyDown(editor, { code: "KeyF", key: "f", metaKey: true })).toBe(true);
  }

  openProjectPage("action:chord:⌘F", "/p");

  if (state !== "editor") captured.run();

  expect(find.calls).toEqual([]);
});

it("u3787b_menu_and_key_share_one_action: row Switcher from key", async () => {
  const { connected, daemon } = await mountNavigation(false, 0);
  connected().rail.select("a1");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
  const terminal = document.activeElement!;
  const writes = daemon.calls.filter(call => call.method === "terminal.write").length;
  expect(document.activeElement).toBe(terminal);
  expect(screen.queryByRole("combobox")).toBeNull();

    fireEvent.keyDown(terminal, { code: "KeyK", key: "k", metaKey: true });
    fireEvent.keyDown(terminal, { code: "KeyK", key: "k" });

  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox")));
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  expect(connected().rail.selected()).toBe("a1");
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toHaveLength(writes);
});

it("u3787b_menu_and_key_share_one_action: Bubble minimise from key", async () => {
  const { connected, daemon, shells } = await mountNavigation(false, 0);
  connected().rail.select("home");
  daemon.handlers["terminal.open"] = () => {
    shells.push(info("shell", { owner: "home" }));

    return { terminal_id: "shell" };
  };

  openProjectPage("action:chord:⌘T", "/p");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("shell"));
  const terminal = document.activeElement!;
  const writes = daemon.calls.filter(call => call.method === "terminal.write").length;
  expect(document.activeElement).toBe(terminal);

    fireEvent.keyDown(terminal, { code: "KeyK", key: "k", metaKey: true });
    fireEvent.keyDown(terminal, { code: "KeyM", key: "m" });

  await waitFor(() => expect(document.querySelector<HTMLElement>('.bubble[data-bubble="shell"]')?.hidden).toBe(true));
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toHaveLength(writes);
});

it.each([
  { chord: "⌘=", key: "=", code: "Equal", size: 18 },
  { chord: "⌘-", key: "-", code: "Minus", size: 16 },
  { chord: "⌘0", key: "0", code: "Digit0", size: 15 },
])("u3787b_menu_and_key_share_one_action: Terminal font $chord from key", async ({ chord, key, code, size }) => {
  await saveAppSettings({ fontSize: 15 });
  localStorage.setItem("roundup:terminal-font:/p", "17");
  const { connected, daemon, emulators } = await mountNavigation(false, 0);
  connected().rail.select("a1");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
  const terminal = document.activeElement!;
  const emulator = emulators.made.get("t-a1")!;
  const writes = daemon.calls.filter(call => call.method === "terminal.write").length;
  expect(document.activeElement).toBe(terminal);
  expect(emulator.fontSize).toBe(17);
  const resize = vi.spyOn(emulator, "setFontSize");

  fireEvent.keyDown(terminal, { key, code, metaKey: true });

  expect(emulator.fontSize).toBe(size);
  expect(resize).toHaveBeenCalledExactlyOnceWith(size);
  expect(document.activeElement).toBe(terminal);
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toHaveLength(writes);
});

it("u3787b_scoped_menu_does_not_steal_terminal_input: font owner leaves", async () => {
  const { connected, emulators } = await mountNavigation(false, 0);
  connected().rail.select("a1");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
  const captured = captureActions(document.activeElement).find(action => action.keys === "⌘=")!;
  connected().rail.select("a2");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a2"));
  const size = emulators.made.get("t-a2")!.fontSize;
  captured.run();
  expect(emulators.made.get("t-a2")!.fontSize).toBe(size);
});


it("u3787b_menu_and_key_share_one_action: Rail rename from key captures the focused row", async () => {
  const { connected, daemon } = await mountNavigation(false, 0);
  connected().rail.select("a2");
  const row = document.querySelector<HTMLElement>('[data-id="a1"][data-part="item"]')!;
  row.focus();
  expect(document.activeElement).toBe(row);

  fireEvent.keyDown(row, { key: "F2", code: "F2" });

  const field = await screen.findByLabelText("Name", { selector: "input" });
  expect(field.closest("[data-id]")?.getAttribute("data-id")).toBe("a1");
  expect(daemon.calls.filter(call => call.method === "rail.rename")).toHaveLength(0);
  fireEvent.keyDown(field, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(row));
});

it("u3787b_menu_and_key_share_one_action: Help from key returns focus without Terminal input", async () => {
  const { daemon } = await mountNavigation(false, 0);
  const row = document.querySelector<HTMLElement>('[data-part="item"]')!;
  row.focus();
  const writes = daemon.calls.filter(call => call.method === "terminal.write").length;
  expect(document.activeElement).toBe(row);

  fireEvent.keyDown(row, { key: "?", code: "Slash", shiftKey: true });

  const help = await screen.findByRole("dialog", { name: "Help" });
  fireEvent.keyDown(help, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(row));
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toHaveLength(writes);
});

it("u3787b_numbered_assignment_captures_one_todo_and_owner: ninth Agent from key", async () => {
  const number = 9;
  const { daemon } = await mountNavigation(false, 0, number);
  await showEverythingInApp();
  const row = document.querySelector<HTMLButtonElement>('[data-todo="1"] .todo-row-button[aria-pressed]')!;
  row.focus();
  const command = `action:chord:1–9:Digit${number}`;
  const captured = captureActions(row).find(action => action.value === command)!;
  expect(document.activeElement).toBe(row);

  fireEvent.keyDown(row, { key: String(number), code: `Digit${number}` });

  await waitFor(() => expect(daemon.calls.filter(call => call.method === "todo.assign").map(call => call.params)).toEqual([{ id: 1, owner: { kind: "agent", id: `a${number - 1}`, parent: null } }]));
  fireEvent.click(screen.getByLabelText("Add Todo: Overview", { selector: "button" }));
  screen.getByLabelText("New Todo title").focus();
  captured.run();
  openProjectPage(command);
  expect(daemon.calls.filter(call => call.method === "todo.assign")).toHaveLength(1);
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});

it("u3787b_menu_and_key_share_one_action: Pad Open from key captures the focused Pad", async () => {
  const { daemon } = await mountNavigation(false, 0);
  const pads = ["Selected", "Focused"].map(name => ({ name, incarnation: `fixture-${name}`, text: "", updated_at: 0, revision: 1, home: null }));
  Object.assign(daemon.handlers, padHandlers({ pads, history: [] }, () => {}));
  daemon.emit({ actor: USER, name: "pad.changed", data: { name: "Focused" } });
  await showEverythingInApp(undefined, "Pads");
  const selected = document.querySelector<HTMLButtonElement>('[data-pad="Selected"] .pad-name')!;
  const row = document.querySelector<HTMLButtonElement>('[data-pad="Focused"] .pad-name')!;
  fireEvent.click(selected);
  row.focus();
  expect(document.activeElement).toBe(row);

  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });

  await waitFor(() => expect(daemon.calls.filter(call => call.method === "pad.read").map(call => call.params)).toEqual([{ name: "Focused" }]));
  expect(daemon.calls.filter(call => call.method === "pad.write" || call.method === "terminal.write")).toEqual([]);
});

it("u3787b_menu_and_key_share_one_action: Pad Rename from key refuses its editing owner", async () => {
  const { daemon } = await mountNavigation(false, 0);
  const pads = ["Selected", "Focused"].map(name => ({ name, incarnation: `fixture-${name}`, text: "", updated_at: 0, revision: 1, home: null }));
  Object.assign(daemon.handlers, padHandlers({ pads, history: [] }, () => {}));
  daemon.emit({ actor: USER, name: "pad.changed", data: { name: "Focused" } });
  await showEverythingInApp(undefined, "Pads");
  fireEvent.click(document.querySelector<HTMLButtonElement>('[data-pad="Selected"] .pad-name')!);
  const row = document.querySelector<HTMLButtonElement>('[data-pad="Focused"] .pad-name')!;
  row.focus();
  const captured = captureActions(row).find(action => action.value === "action:chord:F2")!;
  expect(document.activeElement).toBe(row);

  fireEvent.keyDown(row, { key: "F2", code: "F2" });

  const field = await screen.findByLabelText("Name", { selector: "input" });
  expect(field.closest("[data-pad]")?.getAttribute("data-pad")).toBe("Focused");
  expect(captured.available()).toBe(false);
  captured.run();
  openProjectPage("action:chord:F2");
  expect(screen.getAllByRole("textbox", { name: "Name" })).toEqual([field]);
  expect(daemon.calls.filter(call => call.method === "pad.rename" || call.method === "pad.write")).toEqual([]);
  fireEvent.keyDown(field, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(document.activeElement?.closest("[data-pad]")?.getAttribute("data-pad")).toBe("Focused"));
});

const creationScope = async () => {
  const fixture = await mountNavigation(true, 0);
  fixture.nodes.push(workstream("home"), agent("a1", "idle", "ready", { parent: "home" }), agent("a2", "idle", "ready", { parent: "home" }));
  fixture.daemon.emit({ actor: USER, name: "rail.changed" });
  await waitFor(() => expect(fixture.connected().rail.nodes).toHaveLength(3));

  return fixture;
};

it("u3787b_menu_and_key_share_one_action: Add Todo from key retains its scope", async () => {
  const { connected, daemon } = await creationScope();
  await showEverythingInApp();
  connected().rail.select("a1");
  const list = document.querySelector<HTMLElement>(".todos-tab")!;
  list.focus();
  const captured = captureActions(list).find(action => action.value === "action:chord:N")!;
  expect(document.activeElement).toBe(list);

  fireEvent.keyDown(list, { key: "n", code: "KeyN" });

  const field = await screen.findByLabelText("New Todo title", { selector: "input" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(fireEvent.keyDown(field, { key: "n", code: "KeyN" })).toBe(true);
  captured.run();
  openProjectPage("action:chord:N");
  fireEvent.input(field, { target: { value: "Captured work" } });
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(daemon.calls.filter(call => call.method === "todo.create").map(call => call.params)).toEqual([
    { title: "Captured work", body: null, blockers: null, owner: { kind: "agent", id: "a1", parent: null } },
  ]));
  await waitFor(() => expect(daemon.calls.filter(call => call.method === "todo.move").map(call => call.params)).toEqual([{ id: 2, home: "home" }]));
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});

it("u3787b_scoped_menu_does_not_steal_terminal_input: Add Todo refuses a changed scope", async () => {
  const { connected, daemon } = await creationScope();
  await showEverythingInApp();
  const list = document.querySelector<HTMLElement>('[data-todo="1"] .todo-row-button[aria-pressed]')!;
  list.focus();
  const captured = captureActions(list).find(action => action.value === "action:chord:N")!;
  connected().rail.select("a2");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a2"));
  captured.run();
  openProjectPage("action:chord:N");
  expect(captured.available()).toBe(false);
  expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a2");
  expect(daemon.calls.filter(call => call.method === "todo.create" || call.method === "terminal.write")).toEqual([]);
});

it("u3787b_menu_and_key_share_one_action: Project Rename from key captures the focused tab", async () => {
  const { app } = await mountNavigation(true, 1);
  const target = document.querySelector<HTMLButtonElement>('.project-tab[data-path="/p"] [role="tab"]')!;
  target.focus();
  const captured = captureActions(target).find(action => action.value === "action:chord:F2")!;
  expect(document.activeElement).toBe(target);
  const rename = vi.spyOn(app, "renameProject");

  fireEvent.keyDown(target, { key: "F2", code: "F2" });

  const field = await screen.findByLabelText<HTMLInputElement>("Project name", { selector: "input" });
  expect(field.closest(".project-tab")?.getAttribute("data-path")).toBe("/p");
  expect(rename).not.toHaveBeenCalled();
  expect(captured.available()).toBe(false);
  captured.run();
  openProjectPage("action:chord:F2", "/p");
  expect(screen.getAllByRole("textbox").filter(editor => editor.closest(".project-tab"))).toEqual([field]);
  fireEvent.input(field, { target: { value: "Renamed Project" } });
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(rename).toHaveBeenCalledExactlyOnceWith("/p", "Renamed Project", "p"));
  expect(document.activeElement?.closest(".project-tab")?.getAttribute("data-path")).toBe("/p");
  const retained = captureActions(document.activeElement).find(action => action.value === "action:chord:F2")!;
  screen.getByLabelText("Ask", { selector: '[role="textbox"]' }).focus();
  expect(retained.available()).toBe(false);
  retained.run();
  openProjectPage("action:chord:F2", "/p");
  expect(screen.getAllByRole("textbox").filter(editor => editor.closest(".project-tab"))).toEqual([]);
});

it.each([
  { chord: "⌘B", key: "b", code: "KeyB", label: "Bold", semantic: "strong" },
  { chord: "⌘I", key: "i", code: "KeyI", label: "Italic", semantic: "em" },
  { chord: "⌘E", key: "e", code: "KeyE", label: "Inline code", semantic: "code" },
])("u3787b_menu_and_key_share_one_action: Pad $label from key captures the editor selection", async ({ chord, key, code, semantic }) => {
  const { daemon } = await mountNavigation(true, 0);
  const pads = [{ name: "Plan", incarnation: "fixture-Plan", text: "chosen untouched", updated_at: 0, revision: 1, home: null }];
  Object.assign(daemon.handlers, padHandlers({ pads, history: [] }, () => {}));
  daemon.emit({ actor: USER, name: "pad.changed", data: { name: "Plan" } });
  await showEverythingInApp(undefined, "Pads");
  const field = await openPad("Plan");
  field.setSelectionRange(1, 7, "forward");
  const surface = screen.getByLabelText("Pad body", { selector: '[role="textbox"]' });
  surface.focus();
  const captured = captureActions(surface).find(action => action.keys === chord)!;
  expect(document.activeElement).toBe(surface);
  expect(field.querySelector(semantic)).toBeNull();

  fireEvent.keyDown(surface, { key, code, metaKey: true });

  expect([...field.querySelectorAll(semantic)].map(node => node.textContent)).toEqual(["chosen"]);
  expect(field.value).toContain(" untouched");
  expect(document.activeElement).toBe(surface);
  const ask = screen.getByLabelText("Ask", { selector: '[role="textbox"]' });
  ask.focus();
  expect(captured.available()).toBe(false);
  captured.run();
  openProjectPage(`action:chord:${chord}`);
  expect([...field.querySelectorAll(semantic)].map(node => node.textContent)).toEqual(["chosen"]);
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});

it.each([
  { chord: "⇧⌘B", key: "B", code: "KeyB", shiftKey: true, altKey: false, semantic: "blockquote" },
  { chord: "⌥⌘8", key: "8", code: "Digit8", shiftKey: false, altKey: true, semantic: "ul" },
  { chord: "⌥⌘7", key: "7", code: "Digit7", shiftKey: false, altKey: true, semantic: "ol" },
  { chord: "⌥⌘C", key: "ç", code: "KeyC", shiftKey: false, altKey: true, semantic: "pre" },
])("u3787b_menu_and_key_share_one_action: Pad block $chord from key captures the editor", async ({ chord, key, code, shiftKey, altKey, semantic }) => {
  const { daemon } = await mountNavigation(true, 0);
  const pads = [{ name: "Plan", incarnation: "fixture-Plan", text: "chosen", updated_at: 0, revision: 1, home: null }];
  Object.assign(daemon.handlers, padHandlers({ pads, history: [] }, () => {}));
  daemon.emit({ actor: USER, name: "pad.changed", data: { name: "Plan" } });
  await showEverythingInApp(undefined, "Pads");
  const field = await openPad("Plan");
  field.setSelectionRange(1, 7, "forward");
  const surface = screen.getByLabelText("Pad body", { selector: '[role="textbox"]' });
  surface.focus();
  const captured = captureActions(surface).find(action => action.keys === chord)!;
  expect(document.activeElement).toBe(surface);
  expect(field.querySelector(semantic)).toBeNull();

  fireEvent.keyDown(surface, { key, code, metaKey: true, shiftKey, altKey });

  expect([...field.querySelectorAll(semantic)].map(node => node.querySelector("p")?.textContent ?? node.textContent)).toEqual(["chosen"]);
  expect(document.activeElement).toBe(surface);
  screen.getByLabelText("Ask", { selector: '[role="textbox"]' }).focus();
  expect(captured.available()).toBe(false);
  captured.run();
  openProjectPage(`action:chord:${chord}`);
  expect([...field.querySelectorAll(semantic)].map(node => node.querySelector("p")?.textContent ?? node.textContent)).toEqual(["chosen"]);
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});
