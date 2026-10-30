import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { batch, createRoot, createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";
import { openProjectPage, projectMenu } from "../testing/menuProbe";
import { showEverythingInApp } from "../testing/showEverything";
import { agent, info, USER, workstream } from "../testing/nodes";
import { padHandlers } from "../testing/stores";
import { openPad } from "../pads/padsFixture";
import { CHORDS } from "./chords";
import { saveAppSettings } from "../settings/preferences";
import type { MenuItem } from "../app/seam";
import { captureActions, registerKeys } from "./registry";

const menuCommands = (items: MenuItem[]): MenuItem[] => items.flatMap(item => item.children ? menuCommands(item.children) : [item]);

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

it.each(["key", "menu"])("u3787b_menu_and_key_share_one_action: Terminal Find from %s", async source => {
  const { connected, daemon } = await mountNavigation(false, 0);
  connected().rail.select("a1");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
  const terminal = document.activeElement;

  if (!(terminal instanceof HTMLElement)) throw new Error("Terminal did not receive focus");

  const inactive = owner(document.createElement("div"));
  const find = owner(terminal);
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:⌘F")?.enabled).toBe(true));
  const writes = daemon.calls.filter(call => call.method === "terminal.write").length;
  expect(document.activeElement).toBe(terminal);
  expect(find.calls).toEqual([]);

  if (source === "key") fireEvent.keyDown(terminal, { code: "KeyF", key: "f", metaKey: true });
  else openProjectPage("action:chord:⌘F", "/p");

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
  await waitFor(() => expect(projectMenu.items.some(item => item.id === "action:chord:⌘F")).toBe(true));
  const captured = captureActions(terminal).find(action => action.keys === "⌘F")!;

  if (state === "unavailable") find.setAvailable(false);
  else if (state === "removed") find.remove();
  else {
    const editor = document.createElement("textarea");
    document.body.append(editor);
    editor.focus();
    expect(fireEvent.keyDown(editor, { code: "KeyF", key: "f", metaKey: true })).toBe(true);
  }

  await waitFor(() => expect(projectMenu.items.some(item => item.id === "action:chord:⌘F")).toBe(false));
  openProjectPage("action:chord:⌘F", "/p");

  if (state !== "editor") captured.run();

  expect(find.calls).toEqual([]);
});


it.each(["key", "menu"])("u3787b_menu_and_key_share_one_action: row Switcher from %s", async source => {
  const { connected, daemon } = await mountNavigation(false, 0);
  connected().rail.select("a1");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
  const terminal = document.activeElement!;
  const writes = daemon.calls.filter(call => call.method === "terminal.write").length;
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:leader:K")?.shortcut).toBe("⌘K K"));
  expect(document.activeElement).toBe(terminal);
  expect(screen.queryByRole("combobox")).toBeNull();

  if (source === "key") {
    fireEvent.keyDown(terminal, { code: "KeyK", key: "k", metaKey: true });
    fireEvent.keyDown(terminal, { code: "KeyK", key: "k" });
  } else openProjectPage("action:leader:K", "/p");

  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox")));
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  expect(connected().rail.selected()).toBe("a1");
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toHaveLength(writes);
});


it.each(["key", "menu"])("u3787b_menu_and_key_share_one_action: Bubble minimise from %s", async source => {
  const { connected, daemon, shells } = await mountNavigation(false, 0);
  connected().rail.select("home");
  daemon.handlers["terminal.open"] = () => {
    shells.push(info("shell", { owner: "home" }));

    return { terminal_id: "shell" };
  };

  openProjectPage("action:chord:⌘T", "/p");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("shell"));
  const terminal = document.activeElement!;
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:leader:M")?.shortcut).toBe("⌘K M"));
  expect(projectMenu.items.find(item => item.id === "action:leader:W")?.shortcut).toBe("⌘K W");
  const writes = daemon.calls.filter(call => call.method === "terminal.write").length;
  expect(document.activeElement).toBe(terminal);

  if (source === "key") {
    fireEvent.keyDown(terminal, { code: "KeyK", key: "k", metaKey: true });
    fireEvent.keyDown(terminal, { code: "KeyM", key: "m" });
  } else openProjectPage("action:leader:M", "/p");

  await waitFor(() => expect(document.querySelector<HTMLElement>('.bubble[data-bubble="shell"]')?.hidden).toBe(true));
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toHaveLength(writes);
});


it.each([
  { chord: "⌘=", key: "=", code: "Equal", size: 18 },
  { chord: "⌘-", key: "-", code: "Minus", size: 16 },
  { chord: "⌘0", key: "0", code: "Digit0", size: 15 },
].flatMap(command => ["key", "menu"].map(source => ({ ...command, source }))))("u3787b_menu_and_key_share_one_action: Terminal font $chord from $source", async ({ chord, key, code, size, source }) => {
  await saveAppSettings({ fontSize: 15 });
  localStorage.setItem("roundup:terminal-font:/p", "17");
  const { connected, daemon, emulators } = await mountNavigation(false, 0);
  connected().rail.select("a1");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
  const terminal = document.activeElement!;
  const emulator = emulators.made.get("t-a1")!;
  await waitFor(() => expect(projectMenu.items.find(item => item.id === `action:chord:${chord}`)?.shortcut).toBe(chord));
  const writes = daemon.calls.filter(call => call.method === "terminal.write").length;
  expect(document.activeElement).toBe(terminal);
  expect(emulator.fontSize).toBe(17);
  const resize = vi.spyOn(emulator, "setFontSize");

  if (source === "key") fireEvent.keyDown(terminal, { key, code, metaKey: true });
  else openProjectPage(`action:chord:${chord}`, "/p");

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

it.each(["terminal", "rail row", "Project tab", "Shelf row", "Pad row", "Pad editor", "triage"])("u3787b_menu_covers_bound_commands: every available command of the %s focus has a menu item", async place => {
  const { connected, daemon } = await mountNavigation(place === "Pad editor", 0);

  if (place !== "Pad editor") {
    connected().rail.select("a1");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));
  }

  if (place === "rail row") document.querySelector<HTMLElement>('[data-part="item"]')!.focus();

  if (place === "Shelf row" || place === "triage") {
    await showEverythingInApp();
    document.querySelector<HTMLElement>('[data-todo="1"] .todo-row-button[aria-pressed]')!.focus();

    if (place === "triage") fireEvent.click(screen.getByRole("button", { name: "Triage" }));
  }

  if (place === "Pad row" || place === "Pad editor") {
    const pads = [{ name: "Plan", incarnation: "fixture-Plan", text: "", updated_at: 0, revision: 1, home: null }];
    Object.assign(daemon.handlers, padHandlers({ pads, history: [] }, () => {}));
    daemon.emit({ actor: USER, name: "pad.changed", data: { name: "Plan" } });
    await showEverythingInApp(undefined, "Pads");
    document.querySelector<HTMLButtonElement>('[data-pad="Plan"] .pad-name')!.focus();

    if (place === "Pad editor") {
      await openPad("Plan");
      screen.getByRole("textbox", { name: "Pad body" }).focus();
    }
  }

  if (place === "Project tab") document.querySelector<HTMLButtonElement>('.project-tab[data-path="/p"] [role="tab"]')!.focus();

  const focus = document.activeElement!;
  const expected = place === "Pad editor" ? "action:chord:⌘I" : place === "Shelf row" ? "action:chord:1–9:Digit9" : place === "triage" ? "action:chord:X" : (place === "rail row" || place === "Pad row" || place === "Project tab") ? "action:chord:F2" : "action:chord:⌘=";
  await waitFor(() => expect(menuCommands(projectMenu.items).some(item => item.id === expected)).toBe(true));
  const available = captureActions(focus).filter(action => action.available() && action.value.startsWith("action:") && !action.value.startsWith("action:chord:⌘K") && action.value !== "action:leader:T");
  const shown = new Map(menuCommands(projectMenu.items).filter(item => item.enabled && item.id.startsWith("action:")).map(item => [item.id, item.shortcut]));

  expect(available.length).toBeGreaterThan(place === "Pad editor" ? 2 : 10);

  for (const action of available) {
    expect(shown.has(action.value), action.value).toBe(true);
    expect(shown.get(action.value), action.value).toBe(action.value.startsWith("action:leader:") ? `⌘K ${action.value.slice(14)}` : action.press?.slice(-1) ?? action.keys);
  }

  expect([...shown.keys()].filter(id => !available.some(action => action.value === id))).toEqual([]);
  expect(document.activeElement).toBe(focus);
});


it.each(["key", "menu"])("u3787b_menu_and_key_share_one_action: Rail rename from %s captures the focused row", async source => {
  const { connected, daemon } = await mountNavigation(false, 0);
  connected().rail.select("a2");
  const row = document.querySelector<HTMLElement>('[data-id="a1"][data-part="item"]')!;
  row.focus();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:F2")?.shortcut).toBe("F2"));
  expect(document.activeElement).toBe(row);

  if (source === "key") fireEvent.keyDown(row, { key: "F2", code: "F2" });
  else openProjectPage("action:chord:F2", "/p");

  const field = await screen.findByRole("textbox", { name: "Name" });
  expect(field.closest("[data-id]")?.getAttribute("data-id")).toBe("a1");
  expect(projectMenu.items.some(item => item.id === "action:chord:F2")).toBe(false);
  expect(daemon.calls.filter(call => call.method === "rail.rename")).toHaveLength(0);
  fireEvent.keyDown(field, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(row));
  expect(projectMenu.items.some(item => item.id === "action:chord:F2")).toBe(true);
});

it.each(["key", "menu"])("u3787b_menu_and_key_share_one_action: Help from %s returns focus without Terminal input", async source => {
  const { daemon } = await mountNavigation(false, 0);
  const row = document.querySelector<HTMLElement>('[data-part="item"]')!;
  row.focus();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:?")?.shortcut).toBe("?"));
  const writes = daemon.calls.filter(call => call.method === "terminal.write").length;
  expect(document.activeElement).toBe(row);

  if (source === "key") fireEvent.keyDown(row, { key: "?", code: "Slash", shiftKey: true });
  else openProjectPage("action:chord:?", "/p");

  const help = await screen.findByRole("dialog", { name: "Help" });
  fireEvent.keyDown(help, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(row));
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toHaveLength(writes);
});


it.each(["key", "menu"])("u3787b_numbered_assignment_captures_one_todo_and_owner: ninth Agent from %s", async source => {
  const number = 9;
  const { daemon } = await mountNavigation(false, 0);
  await showEverythingInApp();
  const row = document.querySelector<HTMLButtonElement>('[data-todo="1"] .todo-row-button[aria-pressed]')!;
  row.focus();
  const command = `action:chord:1–9:Digit${number}`;
  await waitFor(() => expect(menuCommands(projectMenu.items).find(item => item.id === command)?.shortcut).toBe(String(number)));
  const captured = captureActions(row).find(action => action.value === command)!;
  const assignments = projectMenu.items.find(item => item.children?.some(child => child.id === command));
  expect(assignments?.children).toHaveLength(9);
  expect(projectMenu.items.some(item => item.id.startsWith("action:chord:1–9:"))).toBe(false);
  expect(document.activeElement).toBe(row);

  if (source === "key") fireEvent.keyDown(row, { key: String(number), code: `Digit${number}` });
  else openProjectPage(command);

  await waitFor(() => expect(daemon.calls.filter(call => call.method === "todo.assign").map(call => call.params)).toEqual([{ id: 1, owner: { kind: "agent", id: `a${number - 1}`, parent: null } }]));
  fireEvent.click(screen.getByRole("button", { name: "add todo to Overview" }));
  screen.getByLabelText("New Todo title").focus();
  await waitFor(() => expect(menuCommands(projectMenu.items).some(item => item.id.startsWith("action:chord:1–9:"))).toBe(false));
  captured.run();
  openProjectPage(command);
  expect(daemon.calls.filter(call => call.method === "todo.assign")).toHaveLength(1);
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});


it.each(["key", "menu"])("u3787b_menu_and_key_share_one_action: Pad Open from %s captures the focused Pad", async source => {
  const { daemon } = await mountNavigation(false, 0);
  const pads = ["Selected", "Focused"].map(name => ({ name, incarnation: `fixture-${name}`, text: "", updated_at: 0, revision: 1, home: null }));
  Object.assign(daemon.handlers, padHandlers({ pads, history: [] }, () => {}));
  daemon.emit({ actor: USER, name: "pad.changed", data: { name: "Focused" } });
  await showEverythingInApp(undefined, "Pads");
  const selected = document.querySelector<HTMLButtonElement>('[data-pad="Selected"] .pad-name')!;
  const row = document.querySelector<HTMLButtonElement>('[data-pad="Focused"] .pad-name')!;
  fireEvent.click(selected);
  row.focus();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:⏎")?.shortcut).toBe("⏎"));
  expect(document.activeElement).toBe(row);

  if (source === "key") fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  else openProjectPage("action:chord:⏎");

  await waitFor(() => expect(daemon.calls.filter(call => call.method === "pad.read").map(call => call.params)).toEqual([{ name: "Focused" }]));
  expect(daemon.calls.filter(call => call.method === "pad.write" || call.method === "terminal.write")).toEqual([]);
});

it.each(["key", "menu"])("u3787b_menu_and_key_share_one_action: Pad Rename from %s refuses its editing owner", async source => {
  const { daemon } = await mountNavigation(false, 0);
  const pads = ["Selected", "Focused"].map(name => ({ name, incarnation: `fixture-${name}`, text: "", updated_at: 0, revision: 1, home: null }));
  Object.assign(daemon.handlers, padHandlers({ pads, history: [] }, () => {}));
  daemon.emit({ actor: USER, name: "pad.changed", data: { name: "Focused" } });
  await showEverythingInApp(undefined, "Pads");
  fireEvent.click(document.querySelector<HTMLButtonElement>('[data-pad="Selected"] .pad-name')!);
  const row = document.querySelector<HTMLButtonElement>('[data-pad="Focused"] .pad-name')!;
  row.focus();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:F2")?.shortcut).toBe("F2"));
  const captured = captureActions(row).find(action => action.value === "action:chord:F2")!;
  expect(document.activeElement).toBe(row);

  if (source === "key") fireEvent.keyDown(row, { key: "F2", code: "F2" });
  else openProjectPage("action:chord:F2");

  const field = await screen.findByRole("textbox", { name: "Name" });
  expect(field.closest("[data-pad]")?.getAttribute("data-pad")).toBe("Focused");
  await waitFor(() => expect(projectMenu.items.some(item => item.id === "action:chord:F2")).toBe(false));
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

it.each(["key", "menu"])("u3787b_menu_and_key_share_one_action: Add Todo from %s retains its scope", async source => {
  const { connected, daemon } = await creationScope();
  await showEverythingInApp();
  connected().rail.select("a1");
  const list = document.querySelector<HTMLElement>(".todos-tab")!;
  list.focus();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:N")?.shortcut).toBe("N"));
  const captured = captureActions(list).find(action => action.value === "action:chord:N")!;
  expect(document.activeElement).toBe(list);

  if (source === "key") fireEvent.keyDown(list, { key: "n", code: "KeyN" });
  else openProjectPage("action:chord:N");

  const field = await screen.findByRole("textbox", { name: "New Todo title" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(projectMenu.items.some(item => item.id === "action:chord:N")).toBe(false);
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
  await waitFor(() => expect(projectMenu.items.some(item => item.id === "action:chord:N")).toBe(true));
  const captured = captureActions(list).find(action => action.value === "action:chord:N")!;
  connected().rail.select("a2");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a2"));
  captured.run();
  openProjectPage("action:chord:N");
  expect(captured.available()).toBe(false);
  expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a2");
  expect(daemon.calls.filter(call => call.method === "todo.create" || call.method === "terminal.write")).toEqual([]);
});


it.each(["key", "menu"])("u3787b_menu_and_key_share_one_action: Project Rename from %s captures the focused tab", async source => {
  const { app } = await mountNavigation(true, 1);
  const target = document.querySelector<HTMLButtonElement>('.project-tab[data-path="/p"] [role="tab"]')!;
  target.focus();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:F2")?.shortcut).toBe("F2"));
  const captured = captureActions(target).find(action => action.value === "action:chord:F2")!;
  expect(document.activeElement).toBe(target);
  const rename = vi.spyOn(app, "renameProject");

  if (source === "key") fireEvent.keyDown(target, { key: "F2", code: "F2" });
  else openProjectPage("action:chord:F2", "/p");

  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" });
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
  screen.getByRole("textbox", { name: "Ask" }).focus();
  expect(retained.available()).toBe(false);
  retained.run();
  openProjectPage("action:chord:F2", "/p");
  expect(screen.getAllByRole("textbox").filter(editor => editor.closest(".project-tab"))).toEqual([]);
});


it.each([
  { chord: "⌘B", key: "b", code: "KeyB", label: "Bold", semantic: "strong" },
  { chord: "⌘I", key: "i", code: "KeyI", label: "Italic", semantic: "em" },
  { chord: "⌘E", key: "e", code: "KeyE", label: "Inline code (replaces formatting)", semantic: "code" },
].flatMap(command => ["key", "menu"].map(source => ({ ...command, source }))))("u3787b_menu_and_key_share_one_action: Pad $label from $source captures the editor selection", async ({ chord, key, code, semantic, source }) => {
  const { daemon } = await mountNavigation(true, 0);
  const pads = [{ name: "Plan", incarnation: "fixture-Plan", text: "chosen untouched", updated_at: 0, revision: 1, home: null }];
  Object.assign(daemon.handlers, padHandlers({ pads, history: [] }, () => {}));
  daemon.emit({ actor: USER, name: "pad.changed", data: { name: "Plan" } });
  await showEverythingInApp(undefined, "Pads");
  const field = await openPad("Plan");
  field.setSelectionRange(1, 7, "forward");
  const surface = screen.getByRole("textbox", { name: "Pad body" });
  surface.focus();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === `action:chord:${chord}`)).toMatchObject({ shortcut: chord, enabled: true }));
  const captured = captureActions(surface).find(action => action.keys === chord)!;
  expect(document.activeElement).toBe(surface);
  expect(field.querySelector(semantic)).toBeNull();

  if (source === "key") fireEvent.keyDown(surface, { key, code, metaKey: true });
  else openProjectPage(`action:chord:${chord}`);

  expect([...field.querySelectorAll(semantic)].map(node => node.textContent)).toEqual(["chosen"]);
  expect(field.value).toContain(" untouched");
  expect(document.activeElement).toBe(surface);
  const ask = screen.getByRole("textbox", { name: "Ask" });
  ask.focus();
  expect(captured.available()).toBe(false);
  captured.run();
  openProjectPage(`action:chord:${chord}`);
  expect([...field.querySelectorAll(semantic)].map(node => node.textContent)).toEqual(["chosen"]);
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});
