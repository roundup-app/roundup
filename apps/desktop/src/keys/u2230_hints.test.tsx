import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { rowOf } from "../rail/railFixture";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, event, info } from "../testing/nodes";
import type { EmulatorFactory } from "../terminal/emulator";
import { CHORDS, hintsFor, pressOf } from "./chords";
import type { HintPlace } from "./chords";

afterEach(cleanup);

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
  app.handlers["terminal.list"] = () => listed;
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

/** A Terminal Bubble's keys are the leader's (U2239), so no hint line shows there. */
const toBubble = async () => {
  fireEvent.click(document.querySelector<HTMLElement>('[data-id="w"]')!);
  await waitFor(() => expect(document.querySelector(".terminal-tab")).not.toBeNull());
  document.querySelector<HTMLElement>(".terminal-tab")!.focus();
  await waitFor(() => expect(line()).toEqual([]));
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
  it("u2230_every_hint_names_a_bound_chord", async () => {
    for (const [place, go] of [["rail", toRail], ["agent", toPane]] as const) {
      for (const hint of hintsFor(place)) {
        // Each press changes what has focus (take control, the Rail, the next Agent), so each starts on a fresh App.
        cleanup();
        await open();
        await go();

        const chord = CHORDS.find((row) => row.keys === hint.keys);

        expect(chord, `${place} ${hint.keys}`).toBeDefined();
        expect(chord!.hint?.label).toBe(hint.label);
        expect(press(document.activeElement!, chord!.presses[0]!), `${place} ${hint.keys} is bound`).toBe(true);
      }
    }
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

  it("u2230a_hint_keys_are_symbols_with_labels", async () => {
    await open();

    for (const place of ["rail", "agent"] as const) {
      const hints = hintsFor(place);

      expect(hints.length).toBeGreaterThanOrEqual(1);
      expect(hints.length).toBeLessThanOrEqual(4);

      for (const hint of hints) {
        expect(hint.keys).toMatch(/^[⌘⇧⌥⌃]*[^\s]+$/);
        expect(hint.keys).not.toMatch(/\b(cmd|command|shift|alt|ctrl|control|option)\b/i);
        expect(hint.label.length).toBeGreaterThan(0);
      }
    }

    expect(label("agent")).toEqual(["⌘⏎ Take control"]);
    expect(label("rail")).toEqual(["⌘⏎ Take control", "⌘⌫ Remove"]);
    expect(label("rail", false)).toEqual(["⌘⌫ Remove"]);
  });
});
