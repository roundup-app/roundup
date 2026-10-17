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

  const press = (key: string, init: KeyboardEventInit = {}) => {
    const code = KEYS.get(key) ?? 0;
    const down = new KeyboardEvent("keydown", { key, code: key, keyCode: code, bubbles: true, cancelable: true, ...init });

    terminal.textarea?.dispatchEvent(down);

    if (!down.defaultPrevented && !init.isComposing) {
      terminal.textarea?.dispatchEvent(new KeyboardEvent("keypress", { key, keyCode: code, bubbles: true, cancelable: true, ...init }));
    }

    terminal.textarea?.dispatchEvent(new KeyboardEvent("keyup", { key, keyCode: code, bubbles: true, cancelable: true, ...init }));
  };

  return { sent, press };
};

const KEYS = new Map<string, number>([["Backspace", 8], ["ArrowLeft", 37], ["ArrowRight", 39]]);

it("u2242_cmd_backspace_left_right_write_line_start_and_end_bytes", () => {
  const { sent, press } = open();

  press("Backspace", { metaKey: true });
  press("ArrowLeft", { metaKey: true });
  press("ArrowRight", { metaKey: true });
  expect(sent).toEqual(["\x15", "\x01", "\x05"]);
});

it("u2242_option_backspace_left_right_write_word_bytes", () => {
  const { sent, press } = open();

  press("Backspace", { altKey: true });
  press("ArrowLeft", { altKey: true });
  press("ArrowRight", { altKey: true });
  expect(sent).toEqual(["\x1b\x7f", "\x1bb", "\x1bf"]);
});

it("u2242_every_ctrl_letter_and_symbol_writes_xterms_byte", () => {
  const { sent, press } = open();

  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(97 + i);

    KEYS.set(letter, 65 + i);
    press(letter, { ctrlKey: true });
  }

  expect(sent).toEqual(Array.from({ length: 26 }, (_, i) => String.fromCharCode(i + 1)));
});

it("u2242_a_held_key_writes_each_repeat_and_extra_modifiers_write_what_they_did", () => {
  const held = open();

  held.press("ArrowLeft", { metaKey: true });
  held.press("ArrowLeft", { metaKey: true, repeat: true });
  held.press("ArrowLeft", { metaKey: true, repeat: true });
  expect(held.sent).toEqual(["\x01", "\x01", "\x01"]);

  const plain = open();

  plain.press("ArrowLeft");
  plain.press("Backspace");
  plain.press("ArrowRight", { altKey: true, shiftKey: true });
  plain.press("ArrowLeft", { metaKey: true, altKey: true });
  expect(plain.sent).toEqual(["\x1b[D", "\x7f", "\x1b[1;4C"]);
});

it("u2242_composition_and_the_follow_up_events_write_nothing", () => {
  const { sent, press } = open();

  press("Backspace", { metaKey: true, isComposing: true, keyCode: 229 });
  expect(sent).toEqual([]);

  press("ArrowLeft", { metaKey: true });
  expect(sent).toEqual(["\x01"]);
});

it("u2242_the_door_and_a_bubble_terminal_do_the_same", () => {
  const first = open();
  const second = open();

  first.press("Backspace", { metaKey: true });
  second.press("Backspace", { metaKey: true });
  expect([first.sent, second.sent]).toEqual([["\x15"], ["\x15"]]);
});
