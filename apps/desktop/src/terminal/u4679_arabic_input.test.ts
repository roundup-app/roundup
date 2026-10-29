import * as xterm from "@xterm/xterm";
import { afterEach, expect, it, vi } from "vitest";
import { createXtermEmulators, type Emulator } from "./emulator";

const made: Emulator[] = [];

afterEach(() => { made.splice(0).forEach(emulator => emulator.dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const setup = () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  const spy = vi.spyOn(xterm, "Terminal");
  const emulator = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }))("arabic");
  const terminal = spy.mock.instances.at(-1)!;
  spy.mockRestore();
  made.push(emulator);
  // Real DOM selection needs an opened xterm; jsdom cannot create a WebGL context.
  emulator.show(document.body.appendChild(document.createElement("div")), false);
  const input: number[][] = [];
  emulator.onInput(bytes => input.push([...bytes]));
  const write = (text: string) => new Promise<void>(resolve => emulator.write(new TextEncoder().encode(text), resolve));

  return { emulator, terminal, input, write };
};

it("u4679_incremental_arabic_preserves_input_and_grid", async () => {
  const { emulator, terminal, input, write } = setup();
  await write("$ ");
  let prefix = "";

  for (const letter of "عربي") {
    terminal.input(letter, true);
    await write(letter);
    prefix += letter;
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("$ " + prefix);
    expect(terminal.buffer.active.cursorX).toBe(2 + prefix.length);
    terminal.select(2, 0, prefix.length);
    expect(emulator.selection()).toBe(prefix);
    const restored = setup();
    const snapshot = emulator.serialize!();
    restored.emulator.setSize(snapshot);
    await restored.write(snapshot.data);
    expect(restored.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("$ " + prefix);
    expect(restored.terminal.buffer.active.cursorX).toBe(2 + prefix.length);
    expect(restored.input).toEqual([]);
  }

  expect(input).toEqual([[216, 185], [216, 177], [216, 168], [217, 138]]);
});

it.each(["$ ", "❯ "])("u4679_arabic_edits_preserve_program_input_%s", async prompt => {
  for (const wide of ["", "🚀 "]) {
    const { terminal, input, write } = setup();
    let text = wide;
    await write(prompt + text);

    for (const letter of "abc عربي 123") {
      terminal.input(letter, true);
      text += letter;
      await write('\r\x1b[2K' + prompt + text);
    }

    terminal.input("\x7f", true);
    text = text.slice(0, -1);
    await write('\r\x1b[2K' + prompt + text);

    for (const letter of " سَلَام") {
      terminal.input(letter, true);
      text += letter;
      await write('\r\x1b[2K' + prompt + text);
    }

    // The fake program consumes exactly the bytes the emulator delivers, with DEL editing one character.
    let received = wide;

    for (const bytes of input) {
      const key = new TextDecoder().decode(Uint8Array.from(bytes));
      received = key === "\x7f" ? received.slice(0, -1) : received + key;
    }

    expect(received).toBe(wide + "abc عربي 12 سَلَام");
    expect(input.flat()).not.toContain(13);
    terminal.input("\r", true);
    expect(input.at(-1)).toEqual([13]);
    expect(input).toHaveLength(21);
    await write(" ASCII");
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(prompt + wide + "abc عربي 12 سَلَام ASCII");
    expect(terminal.buffer.active.cursorX).toBe(wide ? 27 : 24);

    if (wide) expect(terminal.buffer.active.getLine(0)?.getCell(2)?.getWidth()).toBe(2);
  }
});

it("u4679_arabic_redraw_preserves_terminal_data", async () => {
  const { emulator, terminal, input, write } = setup();
  emulator.setSize({ cols: 8, rows: 5 });
  await write("$     ");

  for (const letter of "عربي") {
    terminal.input(letter, true);
    await write(letter);
  }

  terminal.select(6, 0, 4);
  expect(emulator.selection()).toBe("عربي");
  expect(terminal.buffer.active.cursorX).toBe(2);
  expect(terminal.buffer.active.cursorY).toBe(1);
  const restored = setup();
  const snapshot = emulator.serialize!();
  restored.emulator.setSize(snapshot);
  await restored.write(snapshot.data);
  restored.terminal.select(6, 0, 4);
  expect(restored.emulator.selection()).toBe("عربي");
  expect(restored.terminal.buffer.active.cursorX).toBe(2);
  expect(restored.terminal.buffer.active.cursorY).toBe(1);
  await write("\x1b[H\x1b[2J$ عربي\r\nASCII after Arabic");
  expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("$ عربي");
  expect([1, 2, 3].map(row => terminal.buffer.active.getLine(row)?.translateToString(true)).join("")).toBe("ASCII after Arabic");
  expect(terminal.buffer.active.cursorX).toBe(2);
  expect(terminal.buffer.active.cursorY).toBe(3);
  await restored.write("\x1bc" + emulator.serialize!().data);
  terminal.select(0, 1, 18);
  restored.terminal.select(0, 1, 18);
  expect([emulator.selection(), restored.emulator.selection()]).toEqual(["ASCII after Arabic", "ASCII after Arabic"]);
  expect(restored.terminal.buffer.active.cursorX).toBe(2);
  expect(restored.terminal.buffer.active.cursorY).toBe(3);
  expect(input).toEqual([[216, 185], [216, 177], [216, 168], [217, 138]]);
  expect(restored.input).toEqual([]);
});
