import * as xtermModule from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import { cleanup, screen } from "@solidjs/testing-library";
import { createMemo, createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCROLLBACK_LINES, createXtermEmulators, xtermOptions } from "./emulator";
import type { Emulator } from "./emulator";
import { connectFakeProject, fakeEmulators, mountPane, subscribed } from "./paneHarness";
import { createScreens } from "./screens";
import { workstream, info, node, terminal } from "../testing/nodes";

const decoded = (chunks: Uint8Array[]): string[] => chunks.map((chunk) => new TextDecoder().decode(chunk));

const write = (terminal: Terminal, data: string) => new Promise<void>((resolve) => terminal.write(data, resolve));

/** A real xterm emulator with 50 lines already written, scrolled to the bottom. */
const writtenRealEmulator = async (): Promise<{ emulator: Emulator; terminal: Terminal }> => {
  const spy = vi.spyOn(xtermModule, "Terminal");
  const emulator = createXtermEmulators()("t-a");
  // SAFETY: the one Terminal the spy observed is the instance createXtermEmulators just constructed.
  const terminal = spy.mock.instances[0] as Terminal;

  spy.mockRestore();

  for (let line = 0; line < 50; line++) await write(terminal, `line ${line}\r\n`);

  return { emulator, terminal };
};

afterEach(cleanup);

describe("u34 bounded scrollback", () => {
  it("u34_the_real_emulator_is_constructed_with_a_bound_of_10_000_lines", () => {
    expect([SCROLLBACK_LINES, new Terminal(xtermOptions).options.scrollback]).toEqual([10_000, 10_000]);
  });

  it("u34_the_factory_builds_its_real_emulator_with_xtermOptions", () => {
    const spy = vi.spyOn(xtermModule, "Terminal");

    createXtermEmulators()("t-a");

    const calls = spy.mock.calls;

    spy.mockRestore();

    expect(calls).toEqual([[xtermOptions]]);
  });

  it("u34_the_real_emulator_is_at_the_bottom_after_output", async () => {
    const { emulator } = await writtenRealEmulator();

    expect(emulator.isAtBottom()).toBe(true);
  });

  it("u34_scrolling_up_reports_not_at_the_bottom_and_fires_onScroll", async () => {
    const { emulator, terminal } = await writtenRealEmulator();
    let scrolls = 0;

    emulator.onScroll(() => {
      scrolls += 1;
    });
    terminal.scrollToTop();

    expect([emulator.isAtBottom(), scrolls]).toEqual([false, 1]);
  });

  it("u34_returning_to_the_bottom_reports_at_the_bottom_and_fires_onScroll_again", async () => {
    const { emulator, terminal } = await writtenRealEmulator();
    let scrolls = 0;

    emulator.onScroll(() => {
      scrolls += 1;
    });
    terminal.scrollToTop();
    emulator.scrollToBottom();

    expect([emulator.isAtBottom(), scrolls]).toEqual([true, 2]);
  });
});

describe("u34 screens keep the latest control hidden through the real emulator's own scroll events", () => {
  it("u34_output_landing_at_the_bottom_does_not_flip_atBottom_despite_many_scroll_events", async () => {
    const spy = vi.spyOn(xtermModule, "Terminal");
    const { connected } = await connectFakeProject([node("a")], [info("t-a")]);
    const screens = createScreens(connected, createXtermEmulators());

    screens.emulatorFor("t-a");

    // SAFETY: the one Terminal the spy observed is the instance createScreens just constructed for "t-a".
    const terminal = spy.mock.instances[0] as Terminal;

    spy.mockRestore();

    for (let line = 0; line < 50; line++) await write(terminal, `line ${line}\r\n`);

    expect(screens.isAtBottom("t-a")).toBe(true);
  });
});

describe("u34 output reaches the selected Terminal (U11)", () => {
  it("u34_output_is_handed_to_the_selected_terminals_emulator_in_order_and_none_is_sent_for_another", async () => {
    const { app, connected, emulators } = await mountPane([node("a"), node("b")], [info("t-a"), info("t-b")]);

    connected.rail.select("a");
    await subscribed(app, "t-a");
    app.emitOutput("t-a", "one");
    app.emitOutput("t-b", "elsewhere");
    app.emitOutput("t-a", "two");

    await vi.waitFor(() => expect(decoded(emulators.get("t-a")?.written ?? [])).toEqual(["one", "two"]));
    expect(emulators.get("t-b")?.written).toBeUndefined();
  });
});

describe("u34 isAtBottom creates the emulator on demand", () => {
  it("u34_isAtBottom_creates_the_emulator_for_an_unseen_terminal_and_reports_at_the_bottom", async () => {
    const { connected } = await connectFakeProject([node("a")], [info("t-a")]);
    const { factory, made } = fakeEmulators();
    const screens = createScreens(connected, factory);

    const atBottom = screens.isAtBottom("t-a");

    expect([atBottom, made.size]).toEqual([true, 1]);
  });

  it("u34_isAtBottom_called_before_emulatorFor_still_reacts_to_later_scrolling", async () => {
    const { connected } = await connectFakeProject([node("a")], [info("t-a")]);
    const { factory, made } = fakeEmulators();
    const screens = createScreens(connected, factory);

    const atBottom = createRoot(() => createMemo(() => screens.isAtBottom("t-a")));
    const first = atBottom();

    made.get("t-a")?.scroll(false);

    expect([first, atBottom()]).toEqual([true, false]);
  });
});

describe("u34 screens creates the emulator on demand", () => {
  it("u34_returnToBottom_creates_the_emulator_for_an_unseen_terminal_instead_of_throwing", async () => {
    const { connected } = await connectFakeProject([node("a")], [info("t-a")]);
    const { factory, made } = fakeEmulators();
    const screens = createScreens(connected, factory);

    screens.returnToBottom("t-a");

    expect([made.size, made.get("t-a")?.scrollsToBottom]).toEqual([1, 1]);
  });
});

describe("u34 the latest control", () => {
  it("u34_is_hidden_while_the_view_is_at_the_bottom", async () => {
    const { connected } = await mountPane([node("a")], [info("t-a")]);

    connected.rail.select("a");

    expect(screen.queryByText("↓ Latest")).toBeNull();
  });

  it("u34_shows_once_the_user_scrolls_up", async () => {
    const { connected, emulators } = await mountPane([node("a")], [info("t-a")]);

    connected.rail.select("a");
    emulators.get("t-a")?.scroll(false);

    expect(screen.queryByText("↓ Latest")).not.toBeNull();
  });

  it("u34_a_selected_group_has_no_latest_control_and_creates_no_emulator", async () => {
    const { connected, emulators } = await mountPane([workstream("g")]);

    connected.rail.select("g");

    expect([screen.queryByText("↓ Latest"), emulators.size]).toEqual([null, 0]);
  });

  it("u34_clicking_it_returns_to_the_newest_line_and_hides_it", async () => {
    const { connected, emulators } = await mountPane([node("a")], [info("t-a")]);

    connected.rail.select("a");
    emulators.get("t-a")?.scroll(false);
    screen.getByText("↓ Latest").click();

    expect([emulators.get("t-a")?.scrollsToBottom, screen.queryByText("↓ Latest")]).toEqual([1, null]);
  });

  it("u34_typing_returns_to_the_newest_line_and_hides_it", async () => {
    const { connected, emulators } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");
    emulators.get("t-a")?.scroll(false);
    emulators.get("t-a")?.type(Uint8Array.of(108));

    expect([emulators.get("t-a")?.scrollsToBottom, screen.queryByText("↓ Latest")]).toEqual([1, null]);
  });

  it("u34_an_exited_terminal_does_not_scroll_on_input", async () => {
    const { connected, emulators } = await mountPane([terminal("a")], [info("t-a", { running: false, exit_code: 0 })]);

    connected.rail.select("a");
    emulators.get("t-a")?.scroll(false);
    emulators.get("t-a")?.type(Uint8Array.of(108));

    expect([emulators.get("t-a")?.scrollsToBottom, screen.queryByText("↓ Latest") !== null]).toEqual([0, true]);
  });

  it("u34_after_the_daemon_exits_typing_does_not_scroll", async () => {
    const { connected, emulators } = await mountPane([terminal("a")], [info("t-a")], 0, () => ({ code: 0 }));

    connected.rail.select("a");
    emulators.get("t-a")?.scroll(false);
    emulators.get("t-a")?.type(Uint8Array.of(108));

    expect([emulators.get("t-a")?.scrollsToBottom, screen.queryByText("↓ Latest") !== null]).toEqual([0, true]);
  });

  it("u34_output_while_scrolled_up_never_moves_the_view", async () => {
    const { app, connected, emulators } = await mountPane([node("a")], [info("t-a")]);

    connected.rail.select("a");
    await subscribed(app, "t-a");
    emulators.get("t-a")?.scroll(false);
    app.emitOutput("t-a", "more");

    expect([emulators.get("t-a")?.scrollsToBottom, screen.queryByText("↓ Latest") !== null]).toEqual([0, true]);
  });
});
