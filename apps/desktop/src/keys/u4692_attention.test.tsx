import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, info, workstream } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { padHandlers, todoHandlers } from "../testing/stores";
import { todo } from "../todos/testHarness";
import { showShelfTab } from "../testing/shelfTabs";
import type { ConnectedProject } from "../state/connectedProject";
import { endLeader } from "./registry";
import { openPad } from "../pads/padsFixture";
import { appSettings } from "../settings/preferences";

afterEach(() => { cleanup(); endLeader(); localStorage.clear(); });

const press = (options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true, metaKey: true, bubbles: true, cancelable: true, ...options });
  document.activeElement!.dispatchEvent(event);

  return event;
};

const open = async (first = false, second = false) => {
  const app = createFakeApp();

  if (!first) app.add("/p");

  if (second) { app.of("/p"); app.add("/q"); app.of("/q").handlers["rail.tree"] = () => [agent("other", "needs-you", "question")]; }

  const nodes = [workstream("home"), door("lead", "idle", "ready", { parent: "home" }), agent("watch", "idle", "ready", { parent: "home" }), workstream("nested"), agent("ask", "error", "failed", { parent: "nested" }), agent("next", "needs-you", "question")];
  app.handlers["rail.tree"] = () => nodes;
  app.handlers["terminal.list"] = () => [info("t-watch", { owner: "watch" }), info("t-lead", { owner: "lead" }), info("t-ask", { owner: "ask" }), info("t-next", { owner: "next" }), info("shell", { owner: "home", title: "shell" })];
  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 0, data: "" });
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.write"] = () => null;
  Object.assign(app.handlers, todoHandlers({ todos: [todo(1, { title: "Work", home: "home" })] }, () => {}), padHandlers({ pads: [{ incarnation: "fixture-1", name: "notes", text: "saved", owner: { kind: "user", id: "you", parent: null }, updated_at: 0, revision: 1, home: "home" }], history: [] }, () => {}));
  let connected: ConnectedProject | undefined;
  const emulators = fakeEmulators();
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} prepareIdle={open => { connected = open; open.showView("workstreams"); open.showView("terminal-tabs"); }} createEmulator={id => {
    const emulator = emulators.factory(id);
    const show = emulator.show;
    const input = emulators.made.get(id)!;
    emulator.show = (host, focus) => {
      const size = show(host, focus);
      const field = host.firstElementChild!;
      // A forwarded key crosses the existing emulator onInput -> terminal.write seam.
      field.addEventListener("keydown", () => input.type(new TextEncoder().encode("j")));

      return size;
    };

    return emulator;
  }} />);

  if (first) await screen.findByRole("button", { name: "Choose folder…" });
  else await screen.findByRole("textbox", { name: "Ask" });

  return { app, connected: () => connected!, writes: () => app.calls.filter(call => call.method === "terminal.write") };
};

const selectedTerminal = async (id: string) => waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe(`t-${id}`));

const row = (id: string) => document.querySelector<HTMLElement>(`.rail-row[data-id="${id}"]`)!;

it.each(["rail", "centre", "shelf", "triage", "ask", "agent", "door", "bubble", "pad", "drawer"])("u4692_the_direct_chord_reaches_attention_from_each_focus_place: %s", async place => {
  const { app, connected, writes } = await open();

  if (place !== "ask") connected().rail.select("home");
  const nested = row("nested");
  const collapse = nested.querySelector<HTMLElement>('[aria-label="Collapse"]');

  if (collapse) fireEvent.click(collapse);
  let target: HTMLElement = place === "rail" ? row("home") : document.querySelector<HTMLElement>(".centre")!;

  if (place === "ask") target = screen.getByRole("textbox", { name: "Ask" });

  if (place === "agent" || place === "door") {
    const id = place === "agent" ? "watch" : "lead";
    connected().rail.select(id);
    await selectedTerminal(id);
    target = document.activeElement instanceof HTMLElement ? document.activeElement : target;
  } else if (place === "bubble") {
    fireEvent.click(await screen.findByRole("button", { name: "shell" }));
    await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("shell"));
    target = document.activeElement instanceof HTMLElement ? document.activeElement : target;
  } else if (["shelf", "triage", "pad", "drawer"].includes(place)) {
    fireEvent.keyDown(document.body, { key: "k", code: "KeyK", metaKey: true });
    fireEvent.keyDown(document.body, { key: "s", code: "KeyS" });
    showShelfTab(place === "pad" ? "Pads" : "Todos");
    const group = await waitFor(() => document.querySelector<HTMLElement>(`${place === "pad" ? ".pads-tab" : ".todos-tab"} [data-part="branch-control"]`) ?? document.querySelector<HTMLElement>('[data-shelf-group="unassigned"] [data-part="branch-control"]')!);

    if (group?.getAttribute("aria-expanded") === "false" || group?.closest('[aria-expanded="false"]')) fireEvent.click(group);

    if (place === "pad") {
      const pad = await screen.findByRole("button", { name: "notes" });
      fireEvent.keyDown(pad, { key: "Enter", code: "Enter" });
      target = await waitFor(() => { const field = document.querySelector<HTMLElement>(".pad-body button"); expect(field).not.toBeNull();

 return field!; });
    } else {
      if (place === "triage") fireEvent.click(await screen.findByRole("button", { name: "Triage" }));
      target = await waitFor(() => { const item = document.querySelector<HTMLElement>(".todo-row-button"); expect(item).not.toBeNull();

 return item!; });

      if (place === "drawer") {
        fireEvent.keyDown(target, { key: "Enter", code: "Enter" });
        target = await waitFor(() => { const field = document.querySelector<HTMLElement>(".drawer[data-open=true] textarea"); expect(field).not.toBeNull();

 return field!; });
      }
    }
  }

  target.tabIndex = -1;
  target.focus();
  expect(document.activeElement).toBe(target);
  expect(press().defaultPrevented).toBe(true);
  expect(connected().rail.selected()).toBe("ask");
  await selectedTerminal("ask");
  expect(row("ask")).not.toBeNull();
  expect(writes()).toEqual([]);
  expect(app.calls.filter(call => call.method === "ask.send")).toEqual([]);
});

it("u4692_a_held_chord_jumps_once", async () => {
  const { connected, writes } = await open();
  press({ repeat: true });
  expect(connected().rail.selected()).not.toBe("ask");
  press();

  for (let count = 0; count < 20; count++) expect(press({ repeat: true }).defaultPrevented).toBe(true);
  expect(connected().rail.selected()).toBe("ask");
  await selectedTerminal("ask");
  fireEvent.keyUp(document.activeElement!, { key: "j", code: "KeyJ", ctrlKey: true, metaKey: true });
  press();
  expect(connected().rail.selected()).toBe("next");
  expect(writes()).toEqual([]);
});

it("u4692_only_the_exact_physical_chord_jumps", async () => {
  const { connected, writes } = await open();

  for (const options of [{ shiftKey: true }, { altKey: true }, { ctrlKey: false }, { metaKey: false }, { code: "KeyH" }]) {
    connected().rail.select("home");
    press(options);
    expect(connected().rail.selected()).toBe("home");
  }

  for (const key of ["J", "д"]) {
    connected().rail.select("home");
    press({ key });
    expect(connected().rail.selected()).toBe("ask");
  }

  await selectedTerminal("ask");
  expect(press({ shiftKey: true }).defaultPrevented).toBe(false);
  await waitFor(() => expect(writes()).toHaveLength(1));
});

it("u4692_without_a_project_the_chord_does_nothing", async () => {
  const { app } = await open(true);
  const before = document.activeElement;
  press();
  expect(document.activeElement).toBe(before);
  expect(app.calls).toEqual([]);
});

it.each(["help", "switcher", "capture", "recording", "leader"])("u4692_modal_layers_block_the_direct_jump: %s", async layer => {
  const { connected, writes } = await open();
  connected().rail.select("home");
  row("home").focus();

  if (layer === "help") fireEvent.keyDown(document.activeElement!, { key: "?", code: "Slash", shiftKey: true });
  else if (layer === "capture") fireEvent.keyDown(document.activeElement!, { key: "T", code: "KeyT", metaKey: true, shiftKey: true });
  else if (layer === "recording") {
    fireEvent.keyDown(document.activeElement!, { key: ",", code: "Comma", metaKey: true });
    fireEvent.click(await screen.findByRole("tab", { name: "Shortcuts" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Quick add a Todo/ }));
  } else {
    fireEvent.keyDown(document.activeElement!, { key: "k", code: "KeyK", metaKey: true });

    if (layer === "switcher") fireEvent.keyDown(document.activeElement!, { key: "k", code: "KeyK" });
  }

  if (layer !== "leader") await waitFor(() => expect(document.querySelector(layer === "help" ? ".help" : layer === "capture" ? ".capture-field" : layer === "switcher" ? ".switcher" : ".settings-shortcut [aria-pressed=true]")).not.toBeNull());
  const saved = appSettings().quickAdd;
  press();
  press({ repeat: true });
  expect(connected().rail.selected()).toBe("home");
  expect(writes()).toEqual([]);

  if (layer === "recording") {
    expect(document.querySelector('.settings-shortcut [aria-invalid=true]')).not.toBeNull();
    expect(appSettings().quickAdd).toBe(saved);
  }
});

it("u4692_jump_preserves_unsubmitted_input", async () => {
  const { app, connected } = await open();
  const draft = "  unfinished 🐈\nexact  ";
  const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Ask" });
  fireEvent.input(field, { target: { value: draft } });
  const before = connected().drafts.list();
  field.focus();
  press();
  await selectedTerminal("ask");
  field.focus();
  expect(field.value).toBe(draft);
  expect(connected().drafts.list()).toEqual(before);
  expect(app.calls.filter(call => call.method === "ask.send")).toEqual([]);
});


it("u4692_project_switch_uses_only_current_attention", async () => {
  const { connected } = await open(false, true);
  fireEvent.click(screen.getByRole("tab", { name: "q" }));
  await waitFor(() => expect(row("other")).not.toBeNull());
  press();
  expect(connected().rail.selected()).toBe("other");
  expect(row("ask")).toBeNull();
  fireEvent.click(document.querySelector('[data-path="/p"] [role="tab"]')!);
  await waitFor(() => expect(row("home")).not.toBeNull());
  press();
  expect(connected().rail.selected()).toBe("ask");
});


it("u4692_jump_preserves_unsubmitted_input_in_a_pad", async () => {
  const { app, connected } = await open();
  connected().rail.select("home");
  fireEvent.keyDown(document.body, { key: "k", code: "KeyK", metaKey: true });
  fireEvent.keyDown(document.body, { key: "s", code: "KeyS" });
  showShelfTab("Pads");
  const field = await openPad("notes");
  const draft = "unfinished 🐈 exact";
  fireEvent.input(field, { target: { value: draft } });
  await waitFor(() => expect(connected().drafts.list().some(record => record.value.source === draft)).toBe(true));
  const before = connected().drafts.list();
  screen.getByRole("textbox", { name: "Pad body" }).focus();
  press();
  await selectedTerminal("ask");
  expect(field.value).toBe(draft);
  expect(connected().drafts.list().map(record => ({ destination: record.destination, value: record.value }))).toEqual(before.map(record => ({ destination: record.destination, value: record.value })));
  expect(app.calls.filter(call => call.method === "ask.send")).toEqual([]);
});
