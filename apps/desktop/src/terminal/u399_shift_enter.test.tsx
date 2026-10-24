import * as xtermModule from "@xterm/xterm";
import { afterEach, expect, it, vi } from "vitest";
import { createXtermEmulators } from "./emulator";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const webgl = () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } });

/** A real xterm, opened, with what it sends collected as text. */
const open = () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));

  const spy = vi.spyOn(xtermModule, "Terminal");
  const emulator = createXtermEmulators(undefined, webgl)("t-a");
  const terminal = spy.mock.instances[0];

  spy.mockRestore();

  if (!terminal) throw new Error("xterm was not created");

  const host = document.createElement("div");
  const sent: string[] = [];

  document.body.append(host);
  emulator.show(host);
  emulator.onInput((bytes) => sent.push(new TextDecoder().decode(bytes)));

  const press = (init: KeyboardEventInit) => {
    const down = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true, ...init });

    terminal.textarea?.dispatchEvent(down);

    // The browser fires a keypress for Enter unless keydown was cancelled or an IME holds the key.
    if (!down.defaultPrevented && !init.isComposing) {
      terminal.textarea?.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", charCode: 13, keyCode: 13, bubbles: true, cancelable: true, ...init }));
    }
  };

  return { sent, press };
};

it("u399_shift_enter_writes_escape_carriage_return_once", () => {
  const { sent, press } = open();

  press({ shiftKey: true });
  expect(sent).toEqual(["\x1b\r"]);
});

it("u399_plain_enter_still_writes_carriage_return", () => {
  const { sent, press } = open();

  press({});
  expect(sent).toEqual(["\r"]);
});

it("u399_alt_enter_and_the_other_chords_write_what_they_did", () => {
  const chords: [KeyboardEventInit, string][] = [
    [{ altKey: true }, "\x1b\r"],
    [{ ctrlKey: true }, "\r"],
    [{ metaKey: true }, "\r"],
    [{ shiftKey: true, ctrlKey: true }, "\r"],
    [{ shiftKey: true, metaKey: true }, "\r"],
  ];

  for (const [init, bytes] of chords) {
    const { sent, press } = open();

    press(init);
    expect(sent, JSON.stringify(init)).toEqual([bytes]);
  }
});

it("u399_a_repeating_shift_enter_writes_a_line_each_repeat", () => {
  const { sent, press } = open();

  press({ shiftKey: true });
  press({ shiftKey: true, repeat: true });
  press({ shiftKey: true, repeat: true });
  expect(sent).toEqual(["\x1b\r", "\x1b\r", "\x1b\r"]);
});

it("u399_shift_enter_during_composition_writes_nothing", () => {
  const { sent, press } = open();

  press({ shiftKey: true, isComposing: true, keyCode: 229 });
  expect(sent).toEqual([]);
});

it("u399_the_door_and_a_bubble_terminal_do_the_same", () => {
  const first = open();
  const second = open();

  first.press({ shiftKey: true });
  second.press({ shiftKey: true });
  expect([first.sent, second.sent]).toEqual([["\x1b\r"], ["\x1b\r"]]);
});
