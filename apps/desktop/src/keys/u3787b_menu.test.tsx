import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { createRoot, createSignal } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";
import { openProjectPage, projectMenu } from "../testing/menuProbe";
import { info } from "../testing/nodes";
import { CHORDS } from "./chords";
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
  const { connected, daemon } = await mountNavigation();
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
  const { connected } = await mountNavigation();
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
  const { connected, daemon } = await mountNavigation();
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
  const { connected, daemon, shells } = await mountNavigation();
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
