import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { showShelfTab } from "../testing/shelfTabs";
import { padHandlers } from "../testing/stores";
import { rowOf } from "../rail/railFixture";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, event, info } from "../testing/nodes";
import type { EmulatorFactory } from "../terminal/emulator";
import { RowIcons } from "../rail/RowIcons";
import { copy } from "../copy";
import { KeyHint } from "./KeyHint";
import { endLeader } from "./registry";
import { CHORDS, HELP_ROWS, hintsFor, pressOf } from "./chords";
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

const label = (place: HintPlace, watching = true): string[] => hintsFor(place, watching).map((hint) => `${hint.keys} ${hint.label}`);

const toRail = async (watching = true) => {
  fireEvent.click(rowOf("b"));
  rowOf("b").focus();
  await waitFor(() => expect(line()).toEqual(label("rail", watching)));
};

const toPane = async () => {
  fireEvent.click(rowOf("b"));
  await waitFor(() => expect(document.querySelector(".pane-control[data-state=managed]")).not.toBeNull());
  document.querySelector<HTMLElement>(".pane-screen textarea")!.focus();
  await waitFor(() => expect(line()).toEqual(label("agent")));
};

/** U2541b: a Terminal Bubble offers existing App chords. */
const toBubble = async () => {
  fireEvent.click(document.querySelector<HTMLElement>('[data-id="w"]')!);
  await waitFor(() => expect(document.querySelector(".terminal-tab")).not.toBeNull());
  document.querySelector<HTMLElement>(".terminal-tab")!.focus();
  await waitFor(() => expect(line()).toEqual(label("bubble")));
};

const toPlace = async (place: "pad" | "drawer") => {
  fireEvent.click(document.querySelector<HTMLElement>('[data-id="w"]')!);
  document.querySelector<HTMLElement>('[data-id="w"]')!.focus();

  if (document.querySelector<HTMLElement>(".window")!.dataset["shelf"] !== "open") {
    fireEvent.keyDown(document.querySelector<HTMLElement>('[data-id="w"]')!, { key: "k", code: "KeyK", metaKey: true });
    fireEvent.keyDown(document.querySelector<HTMLElement>('[data-id="w"]')!, { key: "s", code: "KeyS" });
  }

  showShelfTab("Pads");
  fireEvent.click(await screen.findByRole("button", { name: "notes" }));
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
  it("u2541_one_component_draws_every_key", async () => {
    await open();
    await toRail();

    const keysIn = (selector: string) => [...document.querySelectorAll(selector)].map((row) =>
      [...row.querySelectorAll("kbd")].map((key) => key.textContent).join(""),
    );

    render(() => <RowIcons actions={{ kind: "workstream", add: { disabled: false, run: () => {} }, folder: () => {}, editor: () => {} }} />);
    fireEvent.pointerMove(screen.getAllByRole("button", { name: copy.addAgentLabel }).at(-1)!, { pointerType: "mouse" });
    await waitFor(() => expect(keysIn('[role="tooltip"] .key-chips')).toEqual([CHORDS[0]!.keys]));

    expect(keysIn(".hint-line .hint")).toEqual(hintsFor("rail").map((hint) => hint.keys));
    fireEvent.keyDown(rowOf("b"), { key: "?", shiftKey: true });
    await waitFor(() => expect(keysIn(".help-line")).toEqual(HELP_ROWS.map((row) => row.keys.replace(/\s/g, ""))));
    expect([...document.querySelectorAll(".help-shelf p")].map((row) =>
      [...row.querySelectorAll("kbd")].map((key) => key.textContent),
    )).toEqual([["↑", "↓"], ["⌘⏎"], ["⇧↑", "⇧↓"], ["⌫", "Esc"]]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".help")).toBeNull());
    fireEvent.keyDown(rowOf("b"), { key: "k", code: "KeyK", metaKey: true });
    await waitFor(() => expect(document.querySelector(".leader")).not.toBeNull());
  });

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

  it.each([["rail", toRail], ["agent", toPane], ["bubble", toBubble], ["pad", () => toPlace("pad")], ["drawer", () => toPlace("drawer")]] as const)("u2230_every_hint_names_a_bound_chord_in_%s", async (place, go) => {
      for (const hint of hintsFor(place)) {
        // Each press changes what has focus (take control, the Rail, the next Agent), so each starts on a fresh App.
        cleanup();
        endLeader();
        const app = await open();

        await go();

        const chord = CHORDS.find((row) => row.keys === hint.keys);

        expect(chord, `${place} ${hint.keys}`).toBeDefined();
        expect(chord!.hint?.label).toBe(hint.label);
        expect(press(document.activeElement!, chord!.presses[0]!), `${place} ${hint.keys} is bound`).toBe(true);

        if (hint.keys === "⌘K") expect(document.querySelector('[role="status"].leader')).not.toBeNull();
        else if (hint.keys === "⌘B") await waitFor(() => expect(document.activeElement?.closest(".bubble"), `${place}: ${document.activeElement?.outerHTML}`).not.toBeNull());
        else if (hint.keys === "⌘/") expect(document.querySelector(".ask-input")).not.toBeNull();
        else await waitFor(() => expect(app.calls.some((call) => call.method === (hint.keys === "⌘⌫" ? "rail.remove" : "takeover.begin"))).toBe(true));
      }
  });

  it("u2230a_hints_follow_focus", async () => {
    await open();
    await toRail();
    await toPane();
    const control = screen.getByRole("button", { name: copy.takeOver });
    control.focus();
    fireEvent.click(control);
    await waitFor(() => expect(document.activeElement?.closest(".pane-screen")).not.toBeNull());
    await waitFor(() => expect(line()).toEqual(label("agent", false)));
    fireEvent.keyDown(document.activeElement!, { key: "Enter", code: "Enter", metaKey: true });
    await waitFor(() => expect(document.activeElement).toBe(control));
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


it.each(["Triage", "Maximise"])("u3474d_shown_shortcuts_run_from_their_presented_scope: %s", async target => {
  const app = await open();
  await toRail();
  showShelfTab("Todos");
  const control = await screen.findByRole("button", { name: target });
  control.focus();
  await waitFor(() => expect(line().some(hint => hint.startsWith("D "))).toBe(false));
  fireEvent.keyDown(document.activeElement!, { key: target === "Triage" ? "t" : "m", code: target === "Triage" ? "KeyT" : "KeyM" });

  if (target === "Triage") {
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
