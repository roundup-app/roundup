import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { showShelfTab } from "../testing/shelfTabs";
import { padHandlers } from "../testing/stores";
import { rowOf } from "../rail/railFixture";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, event, info } from "../testing/nodes";
import type { EmulatorFactory } from "../terminal/emulator";
import { copy } from "../copy";
import { KeyHint } from "./KeyHint";
import { endLeader } from "./registry";
import { seedApp } from "../testing/seeds";
import { showEverythingInApp } from "../testing/showEverything";
import { leaderKey } from "./leaderFixture";

afterEach(() => { cleanup(); endLeader(); localStorage.clear(); });

const focusableEmulator = (): EmulatorFactory => () => {
  const field = document.createElement("textarea");

  field.className = "xterm-helper-textarea";

  return {
    write: () => {},
    setSize: () => {},
    setFontSize: () => {},
    reset: () => {},
    selection: () => "",
    onLink: () => {},
    paste: () => {},
    onInput: () => {},
    turns: () => [],
    selectTurn: () => {},
    onSelection: () => {},
    selectionEnd: () => null,
    selectionFacts: () => null,
    show: (host) => {
      host.replaceChildren(field);

      return { cols: 80, rows: 24 };
    },
    fit: () => ({ cols: 80, rows: 24 }),
    focus: () => field.focus(),
    isAtBottom: () => true,
    onScroll: () => {},
    scrollToBottom: () => {},
    dispose: () => {},
  };
};

const open = async () => {
  const app = createFakeApp();
  let listed = [info("1", { owner: "w", title: "zsh" })];

  app.opened.project = { name: "p", path: "/p" };
  app.handlers["rail.tree"] = () => [
    door("w", "idle", "idle", { name: "lead" }),
    ...["a", "b", "c"].map((id) => agent(id, "idle", "x", { parent: "w" })),
  ];
  Object.assign(app.handlers, padHandlers({ pads: [{ incarnation: "fixture-1", name: "notes", text: "", owner: { kind: "user", id: "you", parent: null }, updated_at: 0, revision: 1, home: "w" }], history: [] }, () => {}));
  app.handlers["terminal.list"] = () => listed;
  app.handlers["takeover.begin"] = () => null;
  app.handlers["takeover.end"] = () => null;
  app.handlers["terminal.write"] = () => null;
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  app.handlers["terminal.close"] = ({ id }) => {
    listed = listed.filter((terminal) => terminal.id !== id);
    queueMicrotask(() => app.emit(event({ name: "terminal.changed" })));

    return null;
  };

  render(() => <App app={app} reducedMotion={() => false} clock={() => 0} createEmulator={focusableEmulator()} />);
  await waitFor(() => rowOf("a"));

  return app;
};

const line = (): string[] => [...document.querySelectorAll(".hint-line .hint:not([hidden])")].map((hint) => hint.textContent!.replace(/\s+/g, " ").trim());

const toRail = async () => {
  fireEvent.click(rowOf("b"));
  rowOf("b").focus();
  await waitFor(() => expect(document.querySelector('.hint-line[data-place="rail"]')).not.toBeNull());
};

const toPane = async () => {
  fireEvent.click(rowOf("b"));
  await waitFor(() => expect(document.querySelector(".pane-screen textarea")).not.toBeNull());
  document.querySelector<HTMLElement>(".pane-screen textarea")!.focus();
};

describe("u2230 shortcut hints", () => {
  it("u2541d_a_chord_is_one_chip_and_an_alternative_one_pair", () => {
    const chips = (keys: string) => {
      const { container, unmount } = render(() => <KeyHint keys={keys}>label</KeyHint>);
      const pairs = container.querySelectorAll(".key-chips");
      const result = [pairs.length, [...container.querySelectorAll("kbd")].map((key) => key.textContent)] as const;
      unmount();

      return result;
    };

    expect(chips("⇧Tab")).toEqual([1, ["⇧Tab"]]);
    expect(chips("⌘K")).toEqual([1, ["⌘K"]]);
    expect(chips("J K")).toEqual([1, ["J", "K"]]);
    expect(chips("J / K")).toEqual([1, ["J", "K"]]);
  });

});


it.each(["Triage", "Todos tab", "Maximise"])("u3474d_shown_shortcuts_run_from_their_presented_scope: %s", async target => {
  const app = await open();
  await toRail();
  showShelfTab("Todos");
  const control = target === "Todos tab" ? screen.getByRole("tab", { name: /Todos/ }) : await screen.findByRole("button", { name: target });
  control.focus();
  await waitFor(() => expect(line().some(hint => hint.startsWith("D "))).toBe(false));
  fireEvent.keyDown(document.activeElement!, { key: target !== "Maximise" ? "t" : "m", code: target !== "Maximise" ? "KeyT" : "KeyM" });

  if (target !== "Maximise") {
    const control = screen.getByRole("button", { name: "Triage" });
    // Ark publishes tab focus changes before the next paint. Observe the settled mode.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(control.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
    expect(control.getAttribute("aria-pressed")).toBe("false");
  } else {
    expect(screen.getByRole("button", { name: "Restore" })).toBe(control);
    fireEvent.keyDown(document.activeElement!, { key: "m", code: "KeyM" });
    expect(screen.getByRole("button", { name: "Maximise" })).toBe(control);
  }

  expect(app.calls.filter(call => call.method === "todo.complete" || call.method === "todo.delete")).toEqual([]);
});


it.each(["terminal", "pads", "contenteditable", "dialog", "menu"])("u3474a_keeps_the_current_keyboard_owner: %s", async owner => {
  await open();
  showShelfTab("Todos");
  await waitFor(() => expect(document.querySelector("[data-triage-toggle]")).not.toBeNull());

  if (owner === "terminal") await toPane();
  else {
    showShelfTab(owner === "pads" ? "Pads" : "Todos");

    if (owner !== "pads") {
      const surface = document.createElement("div");
      const control = document.createElement(owner === "contenteditable" ? "div" : "button");

      if (owner === "contenteditable") { control.setAttribute("contenteditable", "true"); control.tabIndex = 0; }
      else { surface.setAttribute("role", owner); surface.dataset.state = "open"; }

      surface.append(control);
      document.querySelector(".shelf")!.append(surface);
      control.focus();
    }
  }

  const event = new KeyboardEvent("keydown", { key: "t", code: "KeyT", bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(document.querySelector("[data-triage-toggle]")?.getAttribute("aria-pressed")).toBe("false");
});


const context = async (name: string) => {
  const { app } = seedApp(name === "empty" ? "empty-project" : "tree-40", 0);

  const tree = await app.handlers["rail.tree"]!(null);
  app.handlers["rail.tree"] = () => tree.filter(node => node.id === "backend" || node.id === "agent-4").map(node => node.id === "agent-4" ? { ...node, parent: "backend" } : node);

  if (name === "empty triage") app.handlers["todo.list"] = () => [];

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={focusableEmulator()} />);
  await screen.findByRole("tree", { name: "Rail" });

  if (name === "empty") {
    (await screen.findByRole("button", { name: copy.newWorkstreamWord.trim() })).focus();
  } else if (["todos", "completed todos", "pads", "shelf", "maximised shelf", "overlay shelf", "triage", "empty triage", "pad", "drawer", "editor"].includes(name)) {
    await showEverythingInApp();

    if (["pads", "pad", "editor"].includes(name)) showShelfTab("Pads");

    if (name === "completed todos") {
      fireEvent.click(screen.getByRole("button", { name: "1 done" }));
      document.querySelector<HTMLButtonElement>('.todo-done-fold .todo-row-button')!.focus();
    } else if (name === "triage" || name === "empty triage") {
      fireEvent.click(await screen.findByRole("button", { name: "Triage" }));

      if (name === "empty triage") screen.getByRole("button", { name: "Triage" }).focus();
      else (await waitFor(() => document.querySelector<HTMLButtonElement>('.todo-row-button[aria-pressed]')!)).focus();
    } else if (name === "shelf" || name.endsWith("shelf")) {
      const control = screen.getByRole("button", { name: "Maximise" });
      control.focus();

      if (name === "maximised shelf") fireEvent.click(control);

      if (name === "overlay shelf") document.querySelector('.window')!.setAttribute('data-shelf-mode', 'overlay');
    } else {
      const row = await waitFor(() => {
        const row = document.querySelector<HTMLButtonElement>(name === "pads" || name === "pad" || name === "editor" ? '.shelf .pad-name' : '.shelf .todo-row-button[aria-pressed]');
        expect(row).not.toBeNull();

        return row!;
      });

      row.focus();

      if (name === "pad" || name === "drawer" || name === "editor") {
        fireEvent.click(row);
        const selector = name === "pad" ? '.pad-body button' : name === "editor" ? '.pad-rich-editor [contenteditable=true]' : '.drawer .close';

        const control = await waitFor(() => { const node = document.querySelector<HTMLElement>(selector); expect(node).not.toBeNull();

 return node!; });

        control.focus();
        await waitFor(() => expect(document.activeElement).toBe(control));
      }
    }
  } else {
    const row = document.querySelector<HTMLButtonElement>('.rail-row[data-id="agent-4"]')!;
    fireEvent.click(row);
    await waitFor(() => expect(document.querySelector('.pane-control')).not.toBeNull());

    if (name === "rail") row.focus();
    else if (name === "rail workstream") {
      const workstream = document.querySelector<HTMLButtonElement>('.rail-row[data-id="backend"]')!;
      fireEvent.click(workstream);
      workstream.focus();
    }
    else if (name === "agent" || name === "taken agent") {
      const control = await screen.findByRole("button", { name: copy.takeOver });

      if (name === "taken agent") fireEvent.click(control);

      control.focus();
    } else if (name === "terminal input") document.querySelector<HTMLTextAreaElement>('.pane-screen textarea')!.focus();
    else if (name === "bubble" || name === "terminal tab") {
      fireEvent.click(document.querySelector<HTMLElement>('.terminal-new')!);
      await waitFor(() => expect(document.querySelector('.bubble')).not.toBeNull());
      document.querySelector<HTMLElement>(name === "bubble" ? '.bubble button' : '.terminal-tab')!.focus();
    } else if (name === "switcher" || name === "empty switcher" || name === "switcher input") {
      row.focus();
      leaderKey("KeyK");
      await screen.findByRole("combobox");

      if (name === "empty switcher") fireEvent.input(document.querySelector('.switcher input')!, { target: { value: 'no result xyz' } });

      if (name !== "switcher input") document.querySelector<HTMLElement>('.switcher')!.focus();
    }
  }

  return app;
};

it.each([
  ["rail", "rail", ["⌘⌫", "⌘⏎"]],
  ["rail workstream", "rail", ["⌘⌫", "⌘⏎"]],
  ["agent", "agent", ["⌘⏎", "⌘B"]],
  ["taken agent", "agent", ["⌘⏎", "⌘B"]],
  ["bubble", "bubble", ["⌘B"]],
  ["terminal tab", "bubble", ["⌘B"]],
  ["todos", "todos", ["O", "D", "T", "1–9"]],
  ["completed todos", "todos", ["D", "T"]],
  ["pads", "pads", ["O", "E", "D"]],
  ["shelf", "shelf", ["M", "Esc", "1–9"]],
  ["maximised shelf", "shelf", ["M", "Esc"]],
  ["overlay shelf", "shelf", ["M", "Esc"]],
  ["triage", "triage", ["J K", "A", "W", "Tab", "⇧Tab", "X", "C", "Esc"]],
  ["empty triage", "triage", ["Esc"]],
  ["pad", "pad", ["Esc", "⌘K", "⌘/"]],
  ["drawer", "drawer", ["Esc", "⌘K", "⌘/"]],
  ["switcher", "switcher", ["⏎", "⇧⏎", "Esc"]],
  ["empty switcher", "switcher", ["Esc"]],
  ["empty", "empty", ["⌘N", "⌘T", "⌘/"]],
] as const)("u3513a_every_hint_line_ends_in_contextual_help: %s", async (name, place, fullKeys) => {
  const app = await context(name);
  const origin = document.activeElement!;
  const selected = document.querySelector('.rail-row[data-selected=true]')?.getAttribute('data-id');
  await waitFor(() => expect(document.querySelector(`.hint-line[data-place="${place}"]`)).not.toBeNull());
  const lines = [...document.querySelectorAll('.hint-line')];
  expect(lines).toHaveLength(1);

  for (const line of lines) {
    const entries = [...line.querySelectorAll('.hint:not([hidden])')];
    expect(entries.length).toBeLessThanOrEqual(4);
    expect(entries.at(-1)?.querySelector("kbd")?.textContent).toBe("?");

    if (name === "empty triage") expect(entries).toHaveLength(1);

    const priorities = new Map(Object.entries({
      todos: ["O", "D", "T"], "completed todos": ["D", "T"], pads: ["O", "E", "D"],
      shelf: ["M", "Esc", "⌘/"], "maximised shelf": ["M", "Esc", "⌘/"], "overlay shelf": ["Esc", "⌘/"],
      triage: ["J K", "A", "X"], "empty triage": [], "empty switcher": ["Esc"],
      "rail workstream": ["⌘K", "⌘/"],
    }));

    if (priorities.has(name)) expect(entries.slice(0, -1).map(entry => entry.querySelector('kbd')?.textContent)).toEqual(priorities.get(name));
  }

  const before = app.calls.length;
  fireEvent.keyDown(document.activeElement!, { key: "?", shiftKey: true });
  const help = await screen.findByRole("dialog", { name: copy.help });
  const keys = [...help.querySelectorAll('.help-origin [data-help-keys]')].map(row => row.getAttribute('data-help-keys'));

  for (const key of fullKeys) expect(keys).toContain(key);

  await waitFor(() => expect(document.querySelector('.hint-line')).toBeNull());
  fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: copy.help })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(origin));
  expect(document.querySelector('.rail-row[data-selected=true]')?.getAttribute('data-id')).toBe(selected);
  expect(app.calls.slice(before).filter(call => !["project.resources", "rail.tree", "terminal.list"].includes(call.method))).toEqual([]);

  if (name === "switcher") {
    fireEvent.keyDown(origin, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(document.querySelector('.switcher')).toBeNull());
    expect(document.querySelector('.rail-row[data-selected=true]')?.getAttribute('data-id')).toBe("backend");
  }

});

it.each(["terminal input", "switcher input"])("u3513c_editable_and_modal_owners_keep_question_mark: %s", async name => {
  const app = await context(name);
  const before = app.calls.length;
  const origin = document.activeElement!;
  fireEvent.keyDown(origin, { key: "?", shiftKey: true });
  expect(document.querySelector('.help')).toBeNull();
  await waitFor(() => expect(document.querySelector('.hint-line')).toBeNull());
  expect(app.calls.slice(before).filter(call => !["project.resources", "rail.tree", "terminal.list"].includes(call.method))).toEqual([]);
});

it.each(["drawer", "switcher"])("u3513b_help_returns_to_its_origin_without_an_underlying_action: %s draft", async name => {
  const app = await context(name);
  const field = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(name === "drawer" ? '.todo-comment-field' : '.switcher input')!;
  fireEvent.input(field, { target: { value: 'unfinished ? work' } });
  const origin = document.activeElement;

  if (!(origin instanceof HTMLElement)) throw new Error("context has no focused frame");
  const id = document.querySelector('.drawer[data-open=true] .todo-detail')?.textContent;
  const before = app.calls.length;

  for (const dismissal of ["Escape", "?"]) {
    origin.focus();
    fireEvent.keyDown(origin, { key: "?", shiftKey: true });
    await screen.findByRole("dialog", { name: copy.help });
    fireEvent.keyDown(document.activeElement!, { key: dismissal, shiftKey: dismissal === "?" });
    await waitFor(() => expect(document.activeElement).toBe(origin));
    expect(field.value).toBe('unfinished ? work');
    expect(document.querySelector('.drawer[data-open=true] .todo-detail')?.textContent).toBe(id);
  }

  expect(app.calls.slice(before).filter(call => !["project.resources", "rail.tree", "terminal.list"].includes(call.method))).toEqual([]);
  fireEvent.keyDown(origin, { key: "Escape" });
  await waitFor(() => expect(document.querySelector(name === "drawer" ? '.drawer[data-open=true]' : '.switcher')).toBeNull());
});
