import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { createRoot, createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";
import { openProjectPage, projectMenu } from "../testing/menuProbe";
import { info } from "../testing/nodes";
import { CHORDS } from "./chords";
import { saveAppSettings } from "../settings/preferences";
import { captureActions, registerKeys } from "./registry";

const disposals: (() => void)[] = [];

afterEach(() => { disposals.splice(0).forEach(dispose => dispose()); cleanup(); localStorage.clear(); });

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

it.each(["terminal", "rail row"])("u3787b_menu_covers_bound_commands: every available command of the %s focus has a menu item", async place => {
  const { connected } = await mountNavigation(false, 0);
  connected().rail.select("a1");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));

  if (place === "rail row") document.querySelector<HTMLElement>('[data-part="item"]')!.focus();

  const focus = document.activeElement!;
  const expected = place === "rail row" ? "action:chord:F2" : "action:chord:⌘=";
  await waitFor(() => expect(projectMenu.items.some(item => item.id === expected)).toBe(true));
  const available = captureActions(focus).filter(action => action.available() && action.value.startsWith("action:") && !action.value.startsWith("action:chord:⌘K") && action.value !== "action:leader:T");
  const shown = new Map(projectMenu.items.filter(item => item.id.startsWith("action:")).map(item => [item.id, item.shortcut]));

  expect(available.length).toBeGreaterThan(10);

  for (const action of available) {
    expect(shown.has(action.value), action.value).toBe(true);
    expect(shown.get(action.value), action.value).toBe(action.value.startsWith("action:leader:") ? `⌘K ${action.value.slice(14)}` : action.keys);
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
