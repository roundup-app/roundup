import * as xtermModule from "@xterm/xterm";
import { afterEach, expect, it, vi } from "vitest";
import { createXtermEmulators } from "./emulator";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const OSC = (body: string) => `\x1b]${body}\x07`;

/** One command as a marked shell prints it: prompt, command, output, end. */
const turn = (command: string, output: string[], exit = 0, cwd = "/work") =>
  OSC(`7;file://host${cwd}`) + OSC("133;A") + "$ " + OSC("133;B") + command + "\r\n" + OSC("133;C") +
  output.map((line) => `${line}\r\n`).join("") + OSC(`133;D;${exit}`);

const open = () => {
  const spy = vi.spyOn(xtermModule, "Terminal");
  const emulator = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }))("t");
  const terminal = spy.mock.instances[0]!;

  spy.mockRestore();
  // xterm keeps no selection until it is open, and jsdom has no matchMedia for it.
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  emulator.show(document.body.appendChild(document.createElement("div")), false);

  const write = (text: string) => new Promise<void>((resolve) => emulator.write(new TextEncoder().encode(text), resolve));

  return { emulator, terminal, write };
};

it("u514_a_turn_spans_its_prompt_command_and_output", async () => {
  const { emulator, write } = open();

  await write(turn("ls", ["a", "b"]) + turn("false", ["no"], 1, "/other") + OSC("133;A") + "$ " + OSC("133;B") + "sleep 9\r\n" + OSC("133;C"));
  expect(emulator.turns()).toEqual([
    { first: 0, last: 2, exit: 0, cwd: "/work", command: "ls" },
    { first: 3, last: 4, exit: 1, cwd: "/other", command: "false" },
    { first: 5, last: 5, exit: null, cwd: "/other", command: "sleep 9" },
  ]);
  emulator.selectTurn(0, false);
  expect(emulator.selection()).toBe("$ ls\na\nb");
  emulator.dispose();
});

it("u514_a_turn_keeps_its_rows_through_resize_and_scrollback", async () => {
  const { emulator, terminal, write } = open();

  terminal.resize(80, 5);
  await write(turn("ls", ["a"]) + turn("cat", Array.from({ length: 12 }, (_, i) => `row ${i}`)));
  // The first Turn has scrolled out of the 5-row screen but not out of scrollback.
  expect(emulator.turns().map((t) => t.first)).toEqual([0, 2]);
  terminal.resize(10, 5);
  expect(emulator.turns().map((t) => t.first)).toEqual([0, 2]);
  emulator.dispose();
});

it("u514_unmarked_output_after_marks_is_no_turn", async () => {
  const { emulator, write } = open();

  await write(turn("ls", ["a"]) + "ssh banner\r\nmore\r\n");
  expect(emulator.turns()).toHaveLength(1);
  emulator.dispose();
});

it("u514_a_terminal_without_marks_has_no_gutter_and_plain_selection_works", async () => {
  const { emulator, terminal, write } = open();

  await write("plain\r\ntext\r\n");
  expect(emulator.turns()).toEqual([]);
  emulator.selectTurn(0, false);
  expect(emulator.selection()).toBe("");
  terminal.selectAll();
  expect(emulator.selection()).toContain("plain");
  emulator.dispose();
});

it("u514_a_gutter_click_selects_the_whole_turn", async () => {
  const { emulator, write } = open();

  await write(turn("ls", ["a"]) + turn("pwd", ["/work"]));
  emulator.selectTurn(1, false);
  expect(emulator.selection()).toBe("$ pwd\n/work");
  emulator.dispose();
});

it("u514_shift_click_extends_over_the_turns_between", async () => {
  const { emulator, write } = open();

  await write(turn("one", ["1"]) + turn("two", ["2"]) + turn("three", ["3"]));
  emulator.selectTurn(0, false);
  emulator.selectTurn(2, true);
  expect(emulator.selection()).toBe("$ one\n1\n$ two\n2\n$ three\n3");
  emulator.selectTurn(1, true);
  expect(emulator.selection()).toBe("$ one\n1\n$ two\n2");
  emulator.dispose();
});

it("ps11_a_reporting_terminal_keeps_its_turn_marks_and_cwd", async () => {
  const { emulator, write } = open();
  const report = (state: string) => `\x1b]7501;state=${state}:kind=question:msg=Which\x1b\\`;

  await write(OSC("7;file://host/work") + OSC("133;A") + "$ " + OSC("133;B") + "ls\r\n" + report("blocked") + OSC("133;C") + "a\r\n" + report("clear") + OSC("133;D;0"));
  expect(emulator.turns()).toEqual([{ first: 0, last: 1, exit: 0, cwd: "/work", command: "ls" }]);
  emulator.dispose();
});
