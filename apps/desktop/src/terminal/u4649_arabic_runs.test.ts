import { afterEach, describe, expect, it, vi } from "vitest";
import * as xterm from "@xterm/xterm";
import { arabicRuns, createXtermEmulators } from "./emulator";

describe("u4649 Arabic words draw joined", () => {
  it("u4649_an_arabic_sentence_is_one_run", () => {
    const line = "  أنا جاهز. قولّي عايز نشتغل على إيه؟";

    expect(arabicRuns(line)).toEqual([[2, line.length]]);
  });

  it("u4649_text_around_an_arabic_run_keeps_its_cells", () => {
    const line = 'Noted: my Rail name is "عامل-إيه-في". Done.';
    const start = line.indexOf("ع");

    expect(arabicRuns(line)).toEqual([[start, line.indexOf('"', start)]]);
  });

  it("u4649_a_row_without_arabic_has_no_run", () => {
    expect(arabicRuns("● Noted: nothing for you to do.")).toEqual([]);
  });
});


afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("u4649_registered_joiner_preserves_terminal_data", async () => {
  const spy = vi.spyOn(xterm, "Terminal");
  const emulator = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }))("t-arabic");
  const real = spy.mock.instances[0]!;
  // xterm creates its real selection service at open; jsdom needs matchMedia only.
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  const registered = vi.spyOn(real, "registerCharacterJoiner");
  const received: Uint8Array[] = [];
  emulator.onInput(bytes => received.push(bytes));

  try {
    emulator.show(document.body.appendChild(document.createElement("div")), false);
    const text = "abc عامل 123 جاهز! xyz";
    await new Promise<void>(resolve => emulator.write(new TextEncoder().encode(text), resolve));
    const row = real.buffer.active.getLine(0)!;
    expect(registered.mock.calls.map(([join]) => join(row.translateToString(true)))).toContainEqual([[4, 18]]);
    expect(row.translateToString(true)).toBe(text);
    expect(Array.from({ length: text.length }, (_, col) => row.getCell(col)!.getWidth())).toEqual(Array(22).fill(1));
    expect({ x: real.buffer.active.cursorX, y: real.buffer.active.cursorY }).toEqual({ x: 22, y: 0 });
    real.select(0, 0, text.length);
    expect(emulator.selection()).toBe(text);
    expect(emulator.serialize!().data).toContain(text);
    emulator.paste("أنا جاهز. قولّي عايز نشتغل على إيه؟");
    expect(received).toEqual([new TextEncoder().encode("أنا جاهز. قولّي عايز نشتغل على إيه؟")]);
    expect(row.translateToString(true)).toBe(text);
  } finally {
    emulator.dispose();
  }
});
