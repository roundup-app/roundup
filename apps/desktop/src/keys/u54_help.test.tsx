import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { rowOf } from "../rail/railFixture";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door } from "../testing/nodes";
import type { EmulatorFactory } from "../terminal/emulator";
import { CHORDS, pressOf } from "./chords";

afterEach(cleanup);

/** A terminal screen with a focusable field, standing in for xterm's helper textarea (as in `u41_app.test.tsx`). */
const focusableEmulator = (): EmulatorFactory => () => {
  const field = document.createElement("textarea");

  return {
    write: () => {},
    setSize: () => {},
    setFontSize: () => {},
    reset: () => {},
    selection: () => "",
    turns: () => [],
    selectTurn: () => {},
    onLink: () => {},
    paste: () => {},
    onInput: () => {},
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
  app.opened.project = { name: "p", path: "/p" };
  app.handlers["rail.tree"] = () => [
    door("w", "idle", "idle", { name: "lead" }),
    ...["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id) => agent(id, "idle", "x", { parent: "w" })),
  ];

  render(() => <App app={app} reducedMotion={() => false} clock={() => 0} createEmulator={focusableEmulator()} />);
  await waitFor(() => rowOf("a"));

  return app;
};

const help = (): HTMLElement | null => document.querySelector<HTMLElement>(".help");

const question = (target: Element): boolean => {
  const press = new KeyboardEvent("keydown", { key: "?", shiftKey: true, bubbles: true, cancelable: true });

  target.dispatchEvent(press);

  return press.defaultPrevented;
};

const keyOf = (code: string): string =>
  code.startsWith("Digit") ? code.slice(5) : code.startsWith("Bracket") ? "]" : code === "Period" ? "." : code === "Comma" ? "," : code === "Backspace" ? code : code === "Backslash" ? "\\" : code === "Slash" ? "/" : code === "Enter" ? code : code.slice(3).toLowerCase();

const MODS = [
  {},
  { metaKey: true },
  { metaKey: true, shiftKey: true },
  { ctrlKey: true },
  { altKey: true },
  { ctrlKey: true, shiftKey: true },
  { altKey: true, shiftKey: true },
];

const CODES = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => `Key${letter}`).concat([..."0123456789"].map((digit) => `Digit${digit}`), ["BracketLeft", "BracketRight", "Period", "Comma", "Backspace", "Backslash", "Slash"]);

/** Every modified press that something in the webview binds, by `preventDefault`, from a Rail row outside any Terminal. */
const boundPresses = (from: Element, modSets: readonly KeyboardEventInit[] = MODS, codes: string[] = CODES): string[] =>
  modSets.flatMap((mods) =>
    codes.flatMap((code) => {
      if (Object.keys(mods).length === 0) return [];

      const key = keyOf(code);
      const press = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...mods });

      from.dispatchEvent(press);
      // `⌘K` opens the modal switcher, which would swallow every later probe.
      document.querySelector(".switcher input, .ask-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

      return press.defaultPrevented ? [pressOf(press)] : [];
    }),
  );

describe("u54 keyboard help", () => {
  it("u471_previous_copy_assertions_are_preserved_help_labels", async () => {
    await open();
    question(rowOf("a"));
    await waitFor(() => expect(help()).not.toBeNull());
    const panel = help()!;

    expect(panel.getAttribute("aria-label")).toBe("Help");
    expect([...panel.querySelectorAll(".help-line")].map((line) => line.textContent?.trim())).toEqual([
      "⌘J  Jump to what needs you", "⌘N  New Agent", "⇧⌘N  New Agent with a prompt",
      "⌘T  New Terminal", "⌘B  Next Bubble", "⌘.  Minimise or restore the Bubble",
      "⇧⌘⌫  Close the Bubble", "⌘K  Switch to a row by name", "⇧⏎  Take control, in the switcher", "⌘1  Focus the Rail", "⌘2  Focus the pane", "⌘⌫  Remove",
      "⌘⏎  Take control", "⌥1–⌥9  Take control of the n-th Agent", "⌥0  Give control back",
      "⇧⌘J  Jump to what needs you in another Project", "⌘\\  Show or hide the work items",
      "⌘/  Ask bar", "⌘,  Models", "⇧⌘]  Next Project", "⇧⌘[  Previous Project",
    ]);
  });
  it("u54_question_mark_in_the_rail_opens_help_listing_each_chord_and_esc_returns_focus", async () => {
    await open();
    rowOf("a").focus();

    expect(question(rowOf("a"))).toBe(true);

    await waitFor(() => expect(help()).not.toBeNull());
    const panel = help();

    expect(panel).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(panel));

    const lines = [...panel!.querySelectorAll(".help-line")].map((line) => line.textContent?.replace(/\s+/g, " ").trim());

    expect(lines).toEqual(CHORDS.map((chord) => `${chord.keys} ${chord.what}`));
    expect(lines.slice(0, 2)).toEqual(["⌘J Jump to what needs you", "⌘N New Agent"]);

    await waitFor(() => expect(document.activeElement).toBe(panel));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    await waitFor(() => expect(help()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(rowOf("a")));
  });

  it("u54_question_mark_again_closes_help", async () => {
    await open();
    rowOf("a").focus();
    question(rowOf("a"));
    await waitFor(() => expect(help()).not.toBeNull());
    question(document.activeElement!);

    await waitFor(() => expect(help()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(rowOf("a")));


  });

  it("u54_question_mark_in_a_terminal_a_text_field_or_nowhere_opens_nothing", async () => {
    await open();
    fireEvent.click(rowOf("a"));
    await waitFor(() => expect(document.querySelector(".pane-screen textarea")).not.toBeNull());

    expect(question(document.querySelector(".pane-screen textarea")!)).toBe(false);
    expect(question(document.body)).toBe(false);
    expect(help()).toBeNull();
  });

  it("u54_while_open_the_listed_chords_do_nothing_and_the_rail_does_not_reorder", async () => {
    const app = await open();
    const calls = app.calls.length;

    rowOf("a").focus();
    question(rowOf("a"));
    await waitFor(() => expect(help()).not.toBeNull());

    expect(boundPresses(document.activeElement!)).toEqual([]);
    expect(app.calls.length).toBe(calls);
    expect(help()).not.toBeNull();
  });

  it("u480_u54_help_stays_in_step_with_the_chords_bound_in_the_webview", async () => {
    await open();
    fireEvent.click(rowOf("a"));
    await waitFor(() => expect(document.querySelector(".terminal-new")).not.toBeNull());

    const listed = CHORDS.filter((chord) => !chord.inRail && !chord.inSwitcher).flatMap((chord) => chord.presses).sort();
    const bound = [...new Set(boundPresses(document.querySelector(".terminal-new")!))].sort();

    expect(bound).toEqual(listed);

    // `⌘⏎` binds from a Rail row, not from a text field (U531); a Rail row prevents any modified `⏎`, so only ⌘⏎ is probed.
    const row = rowOf("a");

    // The tree types ahead on ⌥ and a letter, which a Mac makes into another character and Help lists as no chord (U520); ⌥1 to ⌥9 bind from the Terminal's probe above.
    // ⌘A is the tree's select-all, which one selected row makes no chord either.
    const railPresses = boundPresses(row, MODS.filter((mods) => !("altKey" in mods)), CODES.filter((code) => code !== "KeyA"));

    // A Rail chord binds while focus is in the Rail, and ⌘2 above moved it to the pane.
    const railOnly = ["Enter", "Backspace"].flatMap((code) => {
      row.focus();

      return boundPresses(row, [{ metaKey: true }], [code]);
    });

    const railBound = [...new Set([...railPresses, ...railOnly])].sort();
    const field = document.activeElement;

    fireEvent.keyDown(document.body, { key: "k", code: "KeyK", metaKey: true });
    await waitFor(() => expect(document.querySelector(".switcher input")).not.toBeNull());

    const switcherBound = boundPresses(document.querySelector(".switcher input")!, [{ shiftKey: true }], ["Enter"]);

    expect(switcherBound).toEqual(["shift+Enter"]);
    expect(field).not.toBeNull();
    expect([...new Set([...bound, ...railBound, ...switcherBound])].sort()).toEqual(CHORDS.flatMap((chord) => chord.presses).sort());
  });

});
