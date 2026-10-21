import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { rowOf } from "../rail/railFixture";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door } from "../testing/nodes";
import type { EmulatorFactory } from "../terminal/emulator";
import { CHORDS, HELP_ROWS, pressOf } from "./chords";
import { leaderKey } from "./leaderFixture";
import { endLeader } from "./registry";

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
    onSelection: () => {},
    selectionEnd: () => null,
    selectionFacts: () => null,
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
  code.startsWith("Digit") ? code.slice(5) : code.startsWith("Bracket") ? "]" : code === "Period" ? "." : code.startsWith("Arrow") ? code : code === "Comma" ? "," : code === "Backspace" ? code : code === "Backslash" ? "\\" : code === "Slash" ? "/" : code === "Enter" ? code : code.slice(3).toLowerCase();

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
const boundPresses = async (from: Element, modSets: readonly KeyboardEventInit[] = MODS, codes: string[] = CODES): Promise<string[]> => {
  const bound: string[] = [];

  for (const mods of modSets) {
    for (const code of codes) {
      if (Object.keys(mods).length === 0) continue;

      const key = keyOf(code);
      const press = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...mods });

      from.dispatchEvent(press);
      // `⌘K` arms the leader, which would take every later probe.
      endLeader();

      // Only dismiss prompts opened by the sweep; Escape beneath Help would close Help itself.
      if (!help()) {
        // `⌘/` opens the Ask bar, which would swallow every later probe.
        document.querySelector(".ask-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

        // `⇧⌘N` opens the spawn prompt, which would stop `⌘K` from opening the switcher.
        document.querySelector(".spawn-prompt-field:not([readonly])")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      }

      if (press.defaultPrevented) bound.push(pressOf(press));
    }
  }

  return bound;
};

describe("u54 keyboard help", () => {
  it("u2241_help_lists_exactly_the_kept_keys", async () => {
    await open();
    question(rowOf("a"));
    await waitFor(() => expect(help()).not.toBeNull());
    const panel = help()!;

    expect(panel.getAttribute("aria-label")).toBe("Help");
    expect([...panel.querySelectorAll(".help-line")].map((line) => line.textContent?.trim())).toEqual([
      "⌘N  New Agent", "⇧⌘N  New Agent with a prompt", "⌘T  New Terminal", "⌘K  Wait for one more key",
      "⌘K J  Jump to what needs you", "⌘K ⇧J  Jump to what needs you in another Project", "⌘K K  Switch to a row by name",
      "⌘K M  Minimise or restore the Bubble", "⌘K W  Close the Bubble", "⌘K S  Show or hide the work items", "⌘K T  Capture a Todo", "⌘K I  Open the Inbox",
      "⌘B  Switch Agent / Terminal", "⇧⏎  Take control, in the switcher", "⌘⌫  Remove", "⌘⏎  Take control", "⌘/  Ask bar", "O  Assign a Todo to an owner",
      "M  Maximise", "D  Delete row", "E  Export .md", "Esc  Close",
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

    expect(lines).toEqual(HELP_ROWS.map((chord) => `${chord.keys} ${chord.what}`));

    // U2230: a chord shown as a hint is one of these lines.
    for (const chord of CHORDS.filter((row) => row.hint)) expect(lines).toContain(`${chord.keys} ${chord.what}`);

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

    await waitFor(() => expect(document.activeElement).toBe(help()));
    expect(await boundPresses(document.activeElement!)).toEqual([]);
    expect(app.calls.length).toBe(calls);
    expect(help()).not.toBeNull();
  });

  it("u480_u54_help_stays_in_step_with_the_chords_bound_in_the_webview", async () => {
    await open();
    fireEvent.click(rowOf("a"));
    await waitFor(() => expect(document.querySelector(".terminal-new")).not.toBeNull());

    const listed = CHORDS.filter((chord) => !chord.inRail && !chord.onAgent && !chord.inSwitcher && !chord.inTerminals && !chord.inShelf).flatMap((chord) => chord.presses).sort();
    // Arrow keys are probed for `⌘` alone: the Terminal tabs bind them with other modifiers too (U2230).
    const outsideTerminal = document.querySelector(".terminal-new")!;
    const bound = [...new Set([...(await boundPresses(outsideTerminal)), ...(await boundPresses(outsideTerminal, [{ metaKey: true }], ["ArrowUp", "ArrowDown"]))])].sort();

    expect(bound).toEqual(listed);

    // `⌘⏎` binds from a Rail row, not from a text field (U531); a Rail row prevents any modified `⏎`, so only ⌘⏎ is probed.
    const row = rowOf("a");

    // The tree types ahead on ⌥ and a letter, which a Mac makes into another character and Help lists as no chord (U520); ⌥1 to ⌥9 bind from the Terminal's probe above.
    // ⌘A is the tree's select-all, which one selected row makes no chord either.
    const railPresses = await boundPresses(row, MODS.filter((mods) => !("altKey" in mods)), CODES.filter((code) => code !== "KeyA"));

    // A Rail chord binds while focus is in the Rail, and ⌘2 above moved it to the pane.
    const railOnly: string[] = [];

    for (const code of ["Enter", "Backspace"]) {
      row.focus();
      railOnly.push(...(await boundPresses(row, [{ metaKey: true }], [code])));
    }

    const railBound = [...new Set([...railPresses, ...railOnly])].sort();
    const field = document.activeElement;

    leaderKey("KeyK");
    await waitFor(() => expect(document.querySelector(".switcher input")).not.toBeNull());

    const switcherBound = await boundPresses(document.querySelector(".switcher input")!, [{ shiftKey: true }], ["Enter"]);

    expect(switcherBound).toEqual(["shift+Enter"]);
    expect(field).not.toBeNull();
    expect([...new Set([...bound, ...railBound, ...switcherBound])].sort()).toEqual(CHORDS.filter((chord) => !chord.inTerminals && !chord.inShelf).flatMap((chord) => chord.presses).sort());
  });

});
