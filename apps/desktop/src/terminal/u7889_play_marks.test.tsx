import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import * as xtermModule from "@xterm/xterm";
import { info, node } from "../testing/nodes";
import { createXtermEmulators } from "./emulator";
import { callsTo, mountPane } from "./paneHarness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const BREW = "brew upgrade ollama && brew services restart ollama";

const OLLAMA = "ollama run inkling-2-mini";

/** An Agent whose Terminal prints `lines`, and whose record holds `BREW` and `OLLAMA` as shell commands. */
const mountPrinting = async (lines: string[]) => {
  const mounted = await mountPane([node("a")], [info("t-a")]);

  mounted.app.handlers["agent.printedCommands"] = () => ({ commands: [BREW, OLLAMA] });
  mounted.app.handlers["agent.runPrinted"] = () => ({ terminal_id: "t-shell" });
  mounted.connected.rail.select("a");
  flush();

  const emulator = await vi.waitFor(() => {
    const found = mounted.emulators.get("t-a");

    expect(found?.onFrame).toBeDefined();

    // SAFETY: the expectation above fails the poll until the emulator exists.
    return found as NonNullable<typeof found>;
  });

  emulator.screenLines = lines;
  await vi.waitFor(() => { emulator.frame(); expect(mounted.app.calls.some((call) => call.method === "agent.printedCommands")).toBe(true); });
  await waitFor(() => { emulator.frame(); flush(); expect(screen.queryAllByRole("button", { name: /^Run / })).not.toHaveLength(0); });

  return { ...mounted, emulator };
};

const SCREEN = ["Run this:", `  ${BREW}`, `  ${OLLAMA}`, "  const x = 1;", "ollama run something else"];

it("u7889a_one_play_mark_per_shell_line_and_none_in_prose", async () => {
  await mountPrinting(SCREEN);
  expect(screen.getAllByRole("button", { name: /^Run / }).map((mark) => mark.getAttribute("aria-label"))).toEqual([`Run ${BREW}`, `Run ${OLLAMA}`]);
});

it("u7889a_a_screen_line_matches_only_a_printed_command_wrapped_or_not", () => {
  const spy = vi.spyOn(xtermModule, "Terminal");
  const emulator = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }))("t");
  // SAFETY: the Terminal constructor ran once when the emulator was created.
  const terminal = spy.mock.instances[0] as (typeof spy.mock.instances)[number];

  spy.mockRestore();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  emulator.show(document.body.appendChild(document.createElement("div")), false);
  terminal.resize(20, 10);

  const written = new Promise<void>((resolve) => emulator.write(new TextEncoder().encode(`prose\r\nollama run inkling-2-mini\r\nollama run inkling\r\nls\r\n`), resolve));

  return written.then(() => {
    expect(emulator.playLines?.([OLLAMA, "ls"])).toEqual([{ row: 1, span: 2, command: OLLAMA }, { row: 4, span: 1, command: "ls" }]);
    expect(emulator.playLines?.([])).toEqual([]);
    emulator.dispose();
  });
});

it("u7889b_click_writes_the_command_once_to_the_shell_never_the_agent", async () => {
  const { app } = await mountPrinting(SCREEN);

  screen.getByRole("button", { name: `Run ${OLLAMA}` }).click();
  await vi.waitFor(() => expect(app.calls.filter((call) => call.method === "agent.runPrinted").map((call) => call.params)).toEqual([{ id: "a", command: OLLAMA }]));
  expect(callsTo(app, "terminal.write")).toEqual([]);
});

it("u7889b_no_click_writes_nothing", async () => {
  const { app } = await mountPrinting(SCREEN);

  expect(app.calls.filter((call) => call.method === "agent.runPrinted")).toEqual([]);
  expect(callsTo(app, "terminal.write")).toEqual([]);
});

it("u7889d_click_restores_and_focuses_the_shell_bubble", async () => {
  const { connected } = await mountPrinting(SCREEN);
  const reveal = vi.fn();

  connected.rail.revealTerminal = reveal;
  screen.getByRole("button", { name: `Run ${BREW}` }).click();
  await vi.waitFor(() => expect(reveal).toHaveBeenCalledExactlyOnceWith("t-shell"));
});

it("u7889e_play_mark_is_a_named_button_reachable_by_keyboard", async () => {
  await mountPrinting(SCREEN);

  const mark = screen.getByRole("button", { name: `Run ${OLLAMA}` });

  expect(mark.tabIndex).toBeGreaterThanOrEqual(0);
  mark.focus();
  expect(document.activeElement).toBe(mark);
});
