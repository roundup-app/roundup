import "../pads/PadRichEditor";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import type { ConnectedProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, info, workstream } from "../testing/nodes";
import { padHandlers, todoHandlers } from "../testing/stores";
import { todo } from "../todos/testHarness";
import { fakeEmulators } from "../terminal/paneHarness";
import { showShelfTab } from "../testing/shelfTabs";
import { appSettings } from "../settings/preferences";
import { endLeader } from "./registry";

afterEach(() => { cleanup(); endLeader(); localStorage.clear(); sessionStorage.clear(); });

const press = (options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true, metaKey: true, bubbles: true, cancelable: true, ...options });
  document.activeElement!.dispatchEvent(event);

  return event;
};

const key = (code: string, options: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement!, { key: code.replace("Key", "").toLowerCase(), code, ...options });

const draft = "  Exact unfinished 🦉\nkeep  ";

const open = async (first = false, nodes = [
  workstream("home"),
  agent("watch", "idle", "ready", { parent: "home" }),
  door("door", "idle", "ready", { parent: "home" }),
  workstream("nested", { parent: "home" }),
  agent("need", "error", "Fix this", { parent: "nested" }),
  agent("next", "needs-you", "Answer", { parent: "home" }),
]) => {
  const app = createFakeApp();

  if (!first) { app.add("/other"); app.add("/p"); }

  const daemon = first ? app : app.of("/p");
  daemon.handlers["rail.tree"] = () => nodes;
  daemon.handlers["terminal.list"] = () => [info("shell", { owner: "home", title: "shell" }), ...nodes.flatMap(node => node.terminal_id ? [info(node.terminal_id, { owner: node.id })] : [])];
  daemon.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 0, data: "" });
  daemon.handlers["terminal.resize"] = () => null;
  daemon.handlers["terminal.write"] = () => null;
  Object.assign(daemon.handlers, todoHandlers({ todos: [todo(1, { title: "Work", home: "home" })] }, () => {}));
  Object.assign(daemon.handlers, padHandlers({ pads: [{ incarnation: "notes-1", name: "notes", text: draft, owner: { kind: "user", id: "you", parent: null }, updated_at: 0, revision: 1, home: "home" }], history: [] }, () => {}));
  app.of("/other").handlers["rail.tree"] = () => [agent("other-need", "needs-you", "Answer")];
  let connection: ConnectedProject | undefined;
  const emulators = fakeEmulators();
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} prepareIdle={value => { connection = value; value.showView("terminal-tabs"); }} createEmulator={id => {
    const emulator = emulators.factory(id);
    const show = emulator.show;
    emulator.show = (host, focus) => {
      const size = show(host, focus);
      // A leaked key must reach the real Pane onInput -> terminal.write boundary.
      host.firstElementChild!.addEventListener("keydown", () => emulators.made.get(id)!.type(new TextEncoder().encode("\n")));

      return size;
    };

    return emulator;
  }} />);

  if (first) await screen.findByRole("button", { name: "Choose folder…" });
  else await screen.findByRole("textbox", { name: "Ask" });

  return { app, daemon, connected: () => connection!, emulators };
};

const destination = async (id = "need") => waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe(`t-${id}`));

const shelf = async () => {
  showShelfTab("Todos");

  const group = await waitFor(() => {
    const group = document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]');
    expect(group).not.toBeNull();

 return group!;
  });

  fireEvent.click(group);
};

it.each(["rail", "centre", "shelf", "triage", "ask", "pad", "drawer", "watch", "door", "shell"])("u4692_the_direct_chord_reaches_attention_from_each_focus_place: %s", async place => {
  const { daemon, connected } = await open();
  connected().rail.select("home");
  const nested = document.querySelector<HTMLElement>('.rail-row[data-id="nested"]')!;
  fireEvent.click(within(nested).getByRole("button", { name: "Collapse" }));

  if (place === "ask") connected().rail.select(null);
  let target: HTMLElement;

  if (place === "watch" || place === "door") {
    connected().rail.select(place); await destination(place);
    target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    // Verify the input seam is connected before checking that the shortcut stops it.
    key("KeyX");
    await waitFor(() => expect(daemon.calls.some(call => call.method === "terminal.write")).toBe(true));
    daemon.calls.length = 0;
  } else if (place === "shell") {
    fireEvent.click(await screen.findByRole("button", { name: "shell" }));
    target = await waitFor(() => { const screen = document.querySelector<HTMLElement>('[data-terminal="shell"]'); expect(screen).not.toBeNull();

 return screen!; });
  } else if (["shelf", "triage", "pad", "drawer"].includes(place)) {
    await shelf();

    if (place === "pad") {
      showShelfTab("Pads");
      const pad = await within(await screen.findByLabelText("Pads", { selector: "section" })).findByRole("button", { name: "notes" });
      fireEvent.keyDown(pad, { key: "Enter", code: "Enter" });
      target = await screen.findByLabelText<HTMLElement>("Pad body", { selector: '[role="textbox"]' });
    } else {
      if (place === "triage") fireEvent.click(await screen.findByRole("button", { name: "Triage" }));
      target = await waitFor(() => { const row = document.querySelector<HTMLElement>(".todo-row-button"); expect(row).not.toBeNull();

 return row!; });

      if (place === "drawer") {
        fireEvent.keyDown(target, { key: "Enter", code: "Enter" });
        target = await waitFor(() => { const input = document.querySelector<HTMLElement>(".drawer[data-open=true] textarea, .drawer[data-open=true] input"); expect(input).not.toBeNull();

 return input!; });
      }
    }
  } else target = place === "ask" ? screen.getByRole("textbox", { name: "Ask" }) : document.querySelector<HTMLElement>(place === "rail" ? '.rail-row[data-id="home"]' : ".centre")!;
  target.tabIndex = -1; target.focus();
  expect(document.activeElement).toBe(target);

  expect(press().defaultPrevented).toBe(true);
  expect(connected().rail.selected()).toBe("need");
  expect(document.querySelector('.rail-row[data-id="need"]')).not.toBeNull();
  await destination();
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});

it("u4692_a_repeating_chord_jumps_once", async () => {
  const { connected, daemon } = await open();
  expect(press({ repeat: true }).defaultPrevented).toBe(true);
  expect(connected().rail.selected()).toBeNull();
  press(); await destination();

  for (let i = 0; i < 20; i++) expect(press({ repeat: true }).defaultPrevented).toBe(true);
  expect(connected().rail.selected()).toBe("need");
  fireEvent.keyUp(document.activeElement!, { key: "j", code: "KeyJ", ctrlKey: true, metaKey: true });
  press(); await destination("next");
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});

it("u4692_only_the_exact_physical_chord_jumps", async () => {
  const { connected } = await open();

  for (const options of [{ shiftKey: true }, { altKey: true }, { ctrlKey: false }, { metaKey: false }, { code: "KeyH" }]) {
    press(options); expect(connected().rail.selected()).toBeNull();
  }

  press({ key: "J" }); await destination();
  press({ key: "о" }); await destination("next");
});

it("u4692_project_switch_uses_only_current_attention", async () => {
  const { connected } = await open();
  press(); await destination();
  fireEvent.click(screen.getByRole("tab", { name: /^other/ }));
  await waitFor(() => expect(connected().project.path).toBe("/other"));
  press(); await destination("other-need");
  fireEvent.click(screen.getByRole("tab", { name: /^p / }));
  await waitFor(() => expect(connected().project.path).toBe("/p"));
  expect(connected().rail.selected()).toBe("need");
  press(); await destination("next");
});

it("u4692_without_a_project_the_chord_does_nothing", async () => {
  const { app } = await open(true);
  const target = screen.getByRole("button", { name: "Choose folder…" }); target.focus();
  press(); expect(document.activeElement).toBe(target);
  expect(app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});

it.each(["help", "switcher", "capture", "recording"])("u4692_modal_layers_block_the_direct_jump: %s", async layer => {
  const { connected, daemon } = await open();
  const field = screen.getByRole("textbox", { name: "Ask" });
  fireEvent.input(field, { target: { value: draft } });
  document.querySelector<HTMLElement>('.rail-row[data-id="home"]')!.focus();
  const saved = appSettings().quickAdd;

  if (layer === "help") key("Slash", { key: "?", shiftKey: true });
  else if (layer === "switcher") { key("KeyK", { metaKey: true }); key("KeyK"); }
  else if (layer === "capture") key("KeyT", { metaKey: true, shiftKey: true });
  else {
    window.dispatchEvent(new Event("open-app-settings"));
    const settings = within(await screen.findByRole("region", { name: "Settings" }));
    fireEvent.click(settings.getByRole("tab", { name: "Shortcuts" }));
    fireEvent.click(await settings.findByRole("button", { name: /^Quick add a Todo/ }));
  }

  if (layer !== "recording") await screen.findByRole("dialog");
  const selection = connected().rail.selected();
  press(); press({ repeat: true });
  expect(connected().rail.selected()).toBe(selection);
  expect(daemon.calls.filter(call => call.method === "terminal.write")).toEqual([]);

  if (layer === "recording") {
    expect(appSettings().quickAdd).toBe(saved);
    expect(document.querySelector('.settings-shortcut [aria-invalid=true]')).not.toBeNull();
  }

  key("Escape", { key: "Escape" });

  if (layer === "recording") fireEvent.click(screen.getByRole("button", { name: "← Back" }));
  expect(await screen.findByRole("textbox", { name: "Ask" })).toHaveProperty("value", draft);
});

it.each(["ask", "pad"])("u4692_jump_preserves_unsubmitted_input: %s", async surface => {
  const { connected, daemon } = await open(false, [workstream("home"), agent("need", "needs-you", "Answer", { parent: "home" })]);
  let field: HTMLElement;

  if (surface === "ask") {
    field = screen.getByRole("textbox", { name: "Ask" });
    fireEvent.input(field, { target: { value: draft } });
  } else {
    connected().drafts.edit({ surface: "pads", object: "notes-1", recipient: null }, { originalName: "notes", source: draft, base: "saved", baseRevision: 1 }, null, "ordinary");
    connected().rail.select("home");
    showShelfTab("Pads");
    const pad = await within(await screen.findByLabelText("Pads", { selector: "section" })).findByRole("button", { name: "notes" });
    fireEvent.keyDown(pad, { key: "Enter", code: "Enter" });
    field = await screen.findByLabelText<HTMLElement>("Pad body", { selector: '[role="textbox"]' });
  }

  const original = structuredClone(connected().drafts.list());
  expect(original.some(record => record.value.text === draft || record.value.source === draft)).toBe(true);
  field.focus();
  press();
  await destination();

  if (surface === "ask") {
    connected().rail.select(null);
    expect(await screen.findByRole("textbox", { name: "Ask" })).toHaveProperty("value", draft);
  } else {
    showShelfTab("Pads");
    const pad = await within(await screen.findByLabelText("Pads", { selector: "section" })).findByRole("button", { name: "notes" });
    fireEvent.keyDown(pad, { key: "Enter", code: "Enter" });
    await screen.findByLabelText<HTMLElement>("Pad body", { selector: '[role="textbox"]' });
  }

  expect(connected().drafts.list()).toEqual(original);
  expect(daemon.calls.filter(call => ["ask.send", "message.send", "pad.write"].includes(call.method))).toEqual([]);
});

it("u4692_rendered_direct_jump_and_discovery", async () => {
  const { captureDir } = await import("../testing/captures");

  if (!captureDir("U4692") && !captureDir("U4692a")) return;
  const { openLane } = await import("../todos/laneBrowser");
  const { join } = await import("node:path");
  const { mkdirSync } = await import("node:fs");
  const lane = await openLane(1512, "dark", "u4692");
  const dir = captureDir("U4692")!;
  mkdirSync(dir, { recursive: true });

  try {
    await lane.browser("record", "start", join(dir, "direct-jump.webm"));
    await lane.browser("set", "media", "dark");
    await lane.until("!!window.__fake && !!document.querySelector('.rail-row')");
    await lane.evaluate(`window.__fake.setStatus('agent-3', 'error', 'Permission denied — choose a writable folder and retry')`);
    await lane.evaluate(`(() => { document.querySelector('.rail-row').focus(); window.__fake.failNext(-32000, 'Permission denied — choose a writable folder and retry'); })()`);
    await lane.browser("press", "Meta+n");
    await lane.until("document.body.textContent.includes('Permission denied — choose a writable folder and retry')");
    await lane.capture("U4692", "before");

    for (const place of ["rail", "terminal", "shelf", "ask"]) {
      if (place === "ask") { await lane.browser("click", "[data-todo-root]"); await lane.until("!!document.querySelector('.ask-input')"); }

      await lane.evaluate(`(() => {
        const target = ${place === "rail" ? "document.querySelector('.rail-row')" : place === "terminal" ? "document.querySelector('.xterm-helper-textarea')" : place === "shelf" ? "document.querySelector('.todo-row-button') || document.querySelector('.shelf button')" : "document.querySelector('.ask-input')"};
        if (!target) throw new Error('Missing ${place} focus target');
        target.focus();
      })()`);
      await lane.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
      await lane.until("!!document.activeElement.closest('.pane-screen')");
      expect(await lane.evaluate("!!document.querySelector('.rail-row[data-selected=true]')")).toBe(true);
      await lane.capture("U4692", `from-${place}`);
    }

    await lane.evaluate("document.querySelector('.rail-row').focus()");
    await lane.browser("press", "?");
    await lane.until("!!document.querySelector('.help')");
    expect(await lane.evaluate("[...document.querySelectorAll('.help .key-chips')].some(el => el.textContent === '⌃⌘J')")).toBe(true);
    await lane.capture("U4692a", "help");
    await lane.browser("press", "Escape");
    await lane.capture("U4692a", "hint");
    await lane.browser("press", "Meta+k");
    await lane.browser("press", "k");
    await lane.until("!!document.querySelector('.switcher')");
    await lane.browser("fill", ".switcher input", "Jump to what needs you");
    await lane.until(`!!document.querySelector('.switcher [data-value^="action:"]')`);
    await lane.capture("U4692a", "switcher");
  } finally { try { await lane.browser("record", "stop"); } finally { await lane.close(); } }
}, 60_000);

it("u4692a_rendered_hint_places", async () => {
  const { captureDir } = await import("../testing/captures");

  if (!captureDir("U4692a")) return;
  const { openLane } = await import("../todos/laneBrowser");
  const lane = await openLane(1512, "dark", "u4692a");

  try {
    await lane.browser("click", "[data-todo-root]");
    await lane.browser("click", "#shelf-tab-pads");
    await lane.until("!!document.querySelector('.pads-tab [data-shelf-group]')");
    await lane.evaluate(`(() => { for (const group of document.querySelectorAll('.pads-tab [data-shelf-group]')) if (group.getAttribute('aria-expanded') === 'false') group.querySelector('[data-part=branch-control]').click(); })()`);
    await lane.until("!!document.querySelector('.pad-inset .pad-name')");
    await lane.browser("focus", ".pad-inset .pad-name");
    await lane.capture("U4692a", "shelf-pad");
    await lane.browser("press", "Enter");
    await lane.until("!!document.querySelector('.pad-body button')");
    await lane.browser("focus", ".pad-body button");
    await lane.capture("U4692a", "pad");
    await lane.browser("focus", ".drawer .close");
    await lane.capture("U4692a", "drawer");
    await lane.browser("click", ".drawer .close");
    await lane.browser("press", "Meta+t");
    await lane.until("!!document.activeElement.closest('.bubble')");
    await lane.capture("U4692a", "bubble");
    await lane.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }))`);
    await lane.until("!!document.activeElement.closest('.pane-screen')");
    expect(await lane.evaluate("!!document.querySelector('.rail-row[data-selected=true]')")).toBe(true);
  } finally { await lane.close(); }
}, 60_000);
