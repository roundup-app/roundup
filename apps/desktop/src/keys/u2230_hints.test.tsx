import { answerQuestion } from "../shelf/bulkQuestionHarness";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { showShelfTab } from "../testing/shelfTabs";
import { padHandlers } from "../testing/stores";
import { rowOf, settled } from "../rail/railFixture";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, event, info } from "../testing/nodes";
import type { EmulatorFactory } from "../terminal/emulator";
import { endLeader } from "./registry";
import { CHORDS, hintsFor, pressOf } from "./chords";
import type { HintPlace } from "./chords";

afterEach(() => { cleanup(); endLeader(); });

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
    prepare: async host => { host.replaceChildren(field);

 return { cols: 80, rows: 24 }; },
    show: (host, focus = true) => {
      host.replaceChildren(field);

      if (focus) field.focus();

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
  // Shelf loads Todos lazily; shortcut assertions must not race its module fetch.
  await import("../todos/Todos");
  const app = createFakeApp();
  let listed = [info("1", { owner: "w", title: "zsh" })];

  app.opened.project = { name: "p", path: "/p" };
  app.handlers["rail.tree"] = () => [
    door("w", "idle", "idle", { name: "lead" }),
    ...["a", "b", "c"].map((id) => agent(id, id === "a" ? "needs-you" : "idle", "x", { parent: "w" })),
  ];
  Object.assign(app.handlers, padHandlers({ pads: [{ incarnation: "fixture-1", name: "notes", text: "", updated_at: 0, revision: 1, home: "w" }], history: [] }, () => {}));
  app.handlers["terminal.list"] = () => listed;
  app.handlers["terminal.write"] = () => null;
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  app.handlers["terminal.close"] = ({ id }) => {
    listed = listed.filter((terminal) => terminal.id !== id);
    queueMicrotask(() => app.emit(event({ name: "terminal.changed" })));

    return null;
  };

  render(() => <App prepareIdle={open => { open.showView("workstreams"); open.showView("terminal-tabs"); }} app={app} reducedMotion={() => false} clock={() => 0} createEmulator={focusableEmulator()} />);
  await waitFor(() => rowOf("a"));

  return app;
};

const line = (): string[] => [...document.querySelectorAll(".hint-line .hint:not([hidden])")].map((hint) => hint.textContent!.replace(/\s+/g, " ").trim());

const label = (place: HintPlace): string[] => hintsFor(place).map((hint) => `${hint.keys} ${hint.label}`);

const toRail = async () => {
  fireEvent.click(rowOf("b"));
  rowOf("b").focus();
  await waitFor(() => expect(line()).toEqual(label("rail")));
};

const toPane = async () => {
  rowOf("b").focus();
  fireEvent.keyDown(rowOf("b"), { key: "Enter", code: "Enter" });
  await waitFor(() => expect(document.querySelector(".pane-screen textarea")).not.toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(document.querySelector(".pane-screen textarea")));
  await waitFor(() => expect(line()).toEqual(label("agent")));
};

/** U2541b: a Terminal Bubble offers existing App chords. */
const toBubble = async () => {
  fireEvent.click(document.querySelector<HTMLElement>('.rail-row[data-id="w"]')!);
  rowOf("lead").focus();
  await settled();
  await waitFor(() => expect(document.querySelector(".terminal-tab")).not.toBeNull());
  document.querySelector<HTMLElement>(".terminal-tab")!.focus();
  await waitFor(() => expect(line()).toEqual(label("bubble")));
};

const toPlace = async (place: "pad" | "drawer") => {
  fireEvent.click(document.querySelector<HTMLElement>('.rail-row[data-id="w"]')!);
  document.querySelector<HTMLElement>('.rail-row[data-id="w"]')!.focus();

  if (document.querySelector<HTMLElement>(".window")!.dataset["shelf"] !== "open") {
    fireEvent.keyDown(document.querySelector<HTMLElement>('.rail-row[data-id="w"]')!, { key: "k", code: "KeyK", metaKey: true });
    fireEvent.keyDown(document.querySelector<HTMLElement>('.rail-row[data-id="w"]')!, { key: "b", code: "KeyB" });
  }

  showShelfTab("Pads");
  const group = document.querySelector('.pads-tab [data-shelf-group="unassigned"]');

  if (group?.getAttribute("aria-expanded") === "false") fireEvent.click(group.querySelector('[data-part="branch-control"]')!);
  fireEvent.keyDown(await screen.findByRole("button", { name: "notes" }), { key: "Enter" });
  const selector = place === "pad" ? ".pad-body button" : ".drawer .close";
  await waitFor(() => expect(document.querySelector(selector)).not.toBeNull());
  document.querySelector<HTMLElement>(selector)!.focus();
  await waitFor(() => expect(line()).toEqual(label(place)));
};

const keyOf = (code: string): string => (code.startsWith("Key") ? code.slice(3).toLowerCase() : code);

const press = (target: Element, presses: string): boolean => {
  const parts = presses.split("+");
  const code = parts.at(-1)!;

  const event = new KeyboardEvent("keydown", {
    code, key: keyOf(code), bubbles: true, cancelable: true,
    ctrlKey: parts.includes("ctrl"), altKey: parts.includes("alt"), metaKey: parts.includes("meta"), shiftKey: parts.includes("shift"),
  });

  target.dispatchEvent(event);

  return event.defaultPrevented && pressOf(event) === presses;
};

describe("u2230 shortcut hints", () => {
  it.each(([["rail", toRail], ["agent", toPane], ["bubble", toBubble], ["pad", () => toPlace("pad")], ["drawer", () => toPlace("drawer")]] as const).flatMap(([place, go]) => hintsFor(place).map(hint => [place, hint.keys, go, hint] as const)))("u2230_every_hint_names_a_bound_chord_in_%s: %s", async (place, _keys, go, hint) => {
    // Each press changes what has focus (the Rail, the next Agent), so each starts on a fresh App.
    cleanup();
    endLeader();
    const app = await open();

    await go();

    const chord = CHORDS.find((row) => row.keys === hint.keys);

    expect(press(document.activeElement!, chord!.presses[0]!), `${place} ${hint.keys} is bound`).toBe(true);

    if (hint.keys === "⌘⌫") await answerQuestion(true);

    if (hint.keys === "⌃⌘J") await waitFor(() => expect(document.activeElement).toBe(document.querySelector(".pane-screen textarea")));
    else if (hint.keys === "⌘K") expect(document.querySelector('[role="status"].leader')).not.toBeNull();
    else if (hint.keys === "⌘B") await waitFor(() => expect(document.activeElement?.closest(".bubble"), `${place}: ${document.activeElement?.outerHTML}`).not.toBeNull());
    else if (hint.keys === "⌘/") expect(document.querySelector(".ask-input")).not.toBeNull();
    else await waitFor(() => expect(app.calls.some((call) => call.method === "rail.remove")).toBe(true));
  });

  it.each(([["rail", toRail], ["agent", toPane], ["bubble", toBubble], ["pad", () => toPlace("pad")]] as const).flatMap(([place, go]) => hintsFor(place).map(hint => [place, hint.keys, go, hint] as const)))("u4690_each_hint_runs_its_key_action_once_in_%s: %s", async (place, _keys, go, hint) => {
    // Each press changes what has focus (the Rail, the next Agent), so each starts on a fresh App.
    cleanup();
    endLeader();
    const app = await open();

    await go();

    const chord = CHORDS.find((row) => row.keys === hint.keys);

    const button = document.querySelector<HTMLButtonElement>(`.hint-line [data-hint="${chord!.keys}"]`)!;
    expect(button.disabled).toBe(false);
    fireEvent.pointerDown(button);
    fireEvent.click(button);

    if (hint.keys === "⌘⌫") await answerQuestion(true);

    if (hint.keys === "⌃⌘J") await waitFor(() => expect(rowOf("a").getAttribute("aria-selected")).toBe("true"));
    else if (hint.keys === "⌘K") expect(document.querySelector('[role="status"].leader')).not.toBeNull();
    else if (hint.keys === "⌘B") await waitFor(() => expect(document.activeElement?.closest(".bubble"), `${place}: ${document.activeElement?.outerHTML}`).not.toBeNull());
    else if (hint.keys === "⌘/") expect(document.querySelector(".ask-input")).not.toBeNull();
    else await waitFor(() => expect(app.calls.some((call) => call.method === "rail.remove")).toBe(true));
    expect(app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
  });

  it("u2230a_hints_follow_focus", async () => {
    await open();
    await toRail();
    await toPane();
    await toRail();
    await toBubble();
    await toRail();

    document.body.focus();

    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await waitFor(() => expect(line()).toEqual([]));

    await toRail();
    fireEvent.keyDown(rowOf("b"), { key: "?", shiftKey: true });
    await waitFor(() => expect(document.querySelector(".help")).not.toBeNull());
    await waitFor(() => expect(line()).toEqual([]));
  });


});


it.each(["Triage", "Todos tab", "Maximise"])("u3474d_shown_shortcuts_run_from_their_presented_scope: %s", async target => {
  const app = await open();
  await toRail();
  showShelfTab("Todos");
  const shelf = within(document.querySelector<HTMLElement>(".shelf")!);
  const control = target === "Todos tab" ? screen.getByRole("tab", { name: /Todos/ }) : await shelf.findByRole("button", { name: target });
  control.focus();
  await waitFor(() => expect(line().some(hint => hint.startsWith("D "))).toBe(false));
  fireEvent.keyDown(document.activeElement!, { key: target !== "Maximise" ? "t" : "m", code: target !== "Maximise" ? "KeyT" : "KeyM" });

  if (target !== "Maximise") {
    const control = await screen.findByRole("button", { name: "Triage" });
    // Ark publishes tab focus changes before the next paint. Observe the settled mode.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(control.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
    expect(control.getAttribute("aria-pressed")).toBe("false");
  } else {
    expect(shelf.getByRole("button", { name: "Restore" })).toBe(control);
    fireEvent.keyDown(document.activeElement!, { key: "m", code: "KeyM" });
    expect(shelf.getByRole("button", { name: "Maximise" })).toBe(control);
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


it("u4453c_hints_use_the_bar_or_key_chips", async () => {
  await open();
  await toRail();
  const retained = document.querySelector(".hint-line")!;
  expect(retained.closest(".resource-agent")).not.toBeNull();
  expect(document.querySelectorAll(".hint-line")).toHaveLength(1);
  const context = line();

  fireEvent.keyDown(rowOf("b"), { key: "k", code: "KeyK", metaKey: true });
  const armed = document.querySelector(".leader")!;

  expect(retained.contains(armed)).toBe(true);
  expect(armed.querySelectorAll(".hint").length).toBeGreaterThan(0);
  expect(line()).not.toEqual(context);
  fireEvent.keyDown(rowOf("b"), { key: "Escape", code: "Escape" });
  expect(document.querySelector(".hint-line")).toBe(retained);
  expect(document.querySelector(".leader")).toBeNull();
  expect(line()).toEqual(context);
});
