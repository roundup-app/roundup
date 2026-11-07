import * as xtermModule from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { afterEach, expect, it, vi } from "vitest";
import { createXtermEmulators } from "./emulator";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const shown = async () => {
  const spy = vi.spyOn(xtermModule, "Terminal");
  const emulator = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }))("t-scroll");
  const terminal = spy.mock.instances[0]!;
  spy.mockRestore();
  const host = document.body.appendChild(document.createElement("div"));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  await emulator.ready;
  emulator.show(host);
  const lines = Array.from({ length: 600 }, (_, index) => `line ${index}`).join("\r\n");
  await new Promise<void>((resolve) => emulator.write(new TextEncoder().encode(lines), resolve));

  return { emulator, terminal, host };
};

it("u6283a_scroll_does_no_own_work", async () => {
  const { emulator, terminal, host } = await shown();
  const proposed = vi.spyOn(FitAddon.prototype, "proposeDimensions");
  const flags = vi.spyOn(terminal.element!.parentElement!, "toggleAttribute");
  const renders = vi.fn();

  terminal.onRender(renders);
  // The first render after output fits and sets the flags once; scrolling then changes neither.
  terminal.refresh(0, terminal.rows - 1);
  await vi.waitFor(() => expect(renders).toHaveBeenCalled());
  proposed.mockClear();
  flags.mockClear();
  renders.mockClear();

  for (let line = 0; line < 500; line += 1) terminal.scrollLines(line % 2 === 0 ? -1 : 1);

  terminal.refresh(0, terminal.rows - 1);
  await vi.waitFor(() => expect(renders).toHaveBeenCalled());
  expect(proposed).not.toHaveBeenCalled();
  expect(flags).not.toHaveBeenCalled();
  emulator.dispose();
  host.remove();
});

it("u6283a_resize_fits_once", async () => {
  const { emulator, host } = await shown();
  const fit = vi.spyOn(FitAddon.prototype, "fit");

  vi.spyOn(FitAddon.prototype, "proposeDimensions").mockReturnValue({ cols: 37, rows: 11 });
  emulator.fit();

  expect(fit).toHaveBeenCalledTimes(1);
  expect(emulator.serialize?.()?.cols).toBe(37);
  emulator.dispose();
  host.remove();
});

it("u6283a_view_work_once_per_frame", async () => {
  const { emulator, terminal, host } = await shown();
  const renders = vi.fn();

  terminal.onRender(renders);
  terminal.refresh(0, terminal.rows - 1);
  await vi.waitFor(() => expect(renders).toHaveBeenCalled());
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const proposed = vi.spyOn(FitAddon.prototype, "proposeDimensions");
  const flags = vi.spyOn(terminal.element!.parentElement!, "toggleAttribute");

  renders.mockClear();

  for (let event = 0; event < 50; event += 1) {
    terminal.scrollLines(event % 2 === 0 ? -1 : 1);
    terminal.refresh(0, terminal.rows - 1);
  }

  await vi.waitFor(() => expect(renders).toHaveBeenCalled());
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(renders.mock.calls.length).toBeLessThanOrEqual(2);
  // The view is the same, so the pass writes and fits nothing.
  expect(flags).not.toHaveBeenCalled();
  expect(proposed).not.toHaveBeenCalled();
  emulator.dispose();
  host.remove();
});

it("u6283a_shown_scrollbar_gets_no_new_timer", async () => {
  const { showScrollbars } = await import("../scrollHover");

  vi.useFakeTimers();
  const element = document.createElement("div");
  const timers = vi.spyOn(globalThis, "setTimeout");
  const write = vi.spyOn(element, "setAttribute");

  showScrollbars(element);

  for (let scroll = 0; scroll < 100; scroll += 1) {
    vi.advanceTimersByTime(4);
    showScrollbars(element);
  }

  expect(timers).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledTimes(1);
  // The bar stays shown while scrolling continues, then hides after the idle delay.
  expect(element.hasAttribute("data-scroll-active")).toBe(true);
  vi.advanceTimersByTime(1000);
  expect(element.hasAttribute("data-scroll-active")).toBe(false);
});

it("u6283b_scrollbar_listener_places_once_per_frame", async () => {
  const { trackScrollbars } = await import("../scrollHover");

  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  const make = () => {
    const element = document.body.appendChild(document.createElement("div"));

    Object.assign(element.style, { overflowX: "auto", overflowY: "auto", height: "40px", width: "40px" });
    const content = element.appendChild(document.createElement("div"));

    content.style.height = "400px";

    return element;
  };

  const [scrolled, other] = [make(), make()];

  trackScrollbars(document);
  await frame();
  const moved = vi.spyOn(scrolled, "getBoundingClientRect");
  const still = vi.spyOn(other, "getBoundingClientRect");

  for (let event = 0; event < 20; event += 1) scrolled.dispatchEvent(new Event("scroll"));

  await frame();
  expect(moved).toHaveBeenCalledTimes(1);
  expect(still).not.toHaveBeenCalled();
  scrolled.remove();
  other.remove();
});

it("u6283a_terminal_mutations_place_no_bar", async () => {
  const { trackScrollbars } = await import("../scrollHover");

  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const tracked = document.body.appendChild(document.createElement("div"));

  Object.assign(tracked.style, { overflowY: "auto", height: "40px", width: "40px" });
  tracked.appendChild(document.createElement("div")).style.height = "400px";
  const terminal = document.body.appendChild(document.createElement("div"));

  terminal.className = "xterm";
  trackScrollbars(document);
  await frame();
  const placed = vi.spyOn(tracked, "getBoundingClientRect");

  for (let row = 0; row < 50; row += 1) terminal.appendChild(document.createElement("div"));

  await frame();
  expect(placed).not.toHaveBeenCalled();
  document.body.appendChild(document.createElement("div"));
  await frame();
  expect(placed).toHaveBeenCalled();
  tracked.remove();
  terminal.remove();
});

const OSC = (body: string) => `\x1b]${body}\x07`;

/** One command with 12 rows of output, taller than the 10-row screen, so the view always sits inside the last Turn. */
const longTurn = () => OSC("133;A") + "$ " + OSC("133;B") + "cmd\r\n" + OSC("133;C") + Array.from({ length: 12 }, (_, row) => `row ${row}\r\n`).join("") + OSC("133;D;0");

/** The per-frame handler calls of one render over a Terminal holding `turns` Turns. */
const frameCalls = async (turns: number) => {
  const { emulator, terminal, host } = await shown();
  let reads = 0;
  const register = terminal.registerMarker.bind(terminal);

  terminal.resize(80, 10);
  vi.spyOn(terminal, "registerMarker").mockImplementation((offset) => {
    const marker = register(offset);

    if (!marker) return marker;

    // A marker whose `line` reads are counted.
    return Object.create(marker, { line: { get: () => { reads += 1; return marker.line; } } });
  });
  const input = longTurn().repeat(turns);

  await new Promise<void>((resolve) => emulator.write(new TextEncoder().encode(input), resolve));
  const renders = vi.fn();
  const lines = vi.spyOn(terminal.buffer.active, "getLine");

  terminal.onRender(renders);
  terminal.refresh(0, terminal.rows - 1);
  await vi.waitFor(() => expect(renders).toHaveBeenCalled());
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  reads = 0;
  lines.mockClear();
  renders.mockClear();
  terminal.scrollLines(-3);
  terminal.refresh(0, terminal.rows - 1);
  await vi.waitFor(() => expect(renders).toHaveBeenCalled());
  const calls = { reads, lines: lines.mock.calls.length, turns: emulator.turns().length };

  emulator.dispose();
  host.remove();

  return calls;
};

it("u6283e_frame_cost_does_not_grow_with_turns", async () => {
  const few = await frameCalls(1);
  const many = await frameCalls(200);

  expect(many.turns).toBe(200);
  // Text rows are read for the Turns in view only, and Turns are found by search, not by walking all of them.
  expect(many.lines).toBe(few.lines);
  expect(many.reads).toBeLessThanOrEqual(few.reads + 2 * Math.ceil(Math.log2(200)) + 6);
}, 30_000);
