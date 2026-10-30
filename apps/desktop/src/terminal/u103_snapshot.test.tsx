import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as xtermModule from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import { ConnectedProjectContext } from "../state/connectedProject";
import type { FakeApp } from "../testing/fakeApp";
import { event, info, node, agent } from "../testing/nodes";
import { connectFakeProject } from "./paneHarness";
import { Pane } from "./Pane";
import { toBase64 } from "./base64";
import { createXtermEmulators } from "./emulator";
import type { Emulator, EmulatorFactory, Size } from "./emulator";

import type { Snapshot } from "@contracts/terminal/Snapshot";

type Reply = Snapshot | Error;

const snapshotOf = (text: string, after: number, size: Size = { cols: 100, rows: 30 }): Snapshot => ({
  ...size,
  after,
  data: toBase64(new TextEncoder().encode(text)),
});

type Recorder = Emulator & { log: string[]; shown: boolean; fits: number };

/** Records, in order, `size <cols>x<rows>` and each written text. */
const recordingEmulators = () => {
  const made = new Map<string, Recorder>();

  const factory: EmulatorFactory = (id) => {
    const log: string[] = [];

    const emulator: Recorder = {
      log,
      shown: false,
      fits: 0,
      setSize: (size) => log.push(`size ${size.cols}x${size.rows}`),
      setFontSize: () => {},
      reset: () => log.push("reset"),
      write: (bytes, parsed) => {
        log.push(new TextDecoder().decode(bytes));
        parsed?.();
      },
      selection: () => "",
      turns: () => [],
      selectTurn: () => {},
            onLink: () => {},
      paste: () => {},
      onInput: () => {},
      onScroll: () => {},
      show: () => {
        emulator.shown = true;

        return { cols: 100, rows: 30 };
      },
      fit: () => {
        emulator.fits += 1;

        return { cols: 100, rows: 30 };
      },
      focus: () => {},
      isAtBottom: () => true,
      scrollToBottom: () => {},
      dispose: () => {},
    };

    made.set(id, emulator);

    return emulator;
  };

  return { factory, made };
};

/** A Pane over a Daemon whose `terminal.snapshot` answers are controlled by the test, one per call. */
const mount = async (
  tree = [node("a")],
  terminals = [info("t-a")],
  configure?: (app: FakeApp) => void,
) => {
  const { app, connected } = await connectFakeProject(tree, terminals);
  const { factory, made } = recordingEmulators();
  const pending: ((reply: Reply) => void)[] = [];
  /** How many output subscriptions were installed when each snapshot was asked for. */
  const subscriptionsAtSnapshot: number[] = [];

  app.handlers["terminal.snapshot"] = () => {
    subscriptionsAtSnapshot.push(app.outputSubscriptions.length);

    return new Promise<Snapshot>((resolve, reject) =>
      pending.push((reply) => (reply instanceof Error ? reject(reply) : resolve(reply))),
    );
  };

  configure?.(app);

  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Pane createEmulator={factory} />
    </ConnectedProjectContext.Provider>
  ));
  connected.rail.select(tree[0]?.id ?? null);

  const snapshots = () => app.calls.filter((call) => call.method === "terminal.snapshot");
  const log = () => made.get("t-a")?.log ?? [];
  const logOf = (id: string) => made.get(id)?.log ?? [];

  return { app, connected, pending, snapshots, subscriptionsAtSnapshot, log, logOf, shown: () => made.get("t-a")?.shown ?? false, fits: () => made.get("t-a")?.fits ?? 0 };
};

/** Both attempts of one captured read fail before its exhausted line is asserted. */
const exhaust = async (pending: ((reply: Reply) => void)[], index: number, message: string) => {
  pending[index]?.(new Error(message));
  await vi.waitFor(() => expect(pending).toHaveLength(index + 2));
  pending[index + 1]?.(new Error(message));
};

const typed = (app: { calls: { method: string }[] }) => app.calls.filter((call) => call.method === "terminal.write");

afterEach(cleanup);

describe("u103 a reloaded pane shows the screen", () => {
  it("u103_the_real_emulator_resets_after_queued_output_before_the_replacement_screen", async () => {
    const spy = vi.spyOn(xtermModule, "Terminal");
    const emulator = createXtermEmulators()("t-a");
    // SAFETY: the factory created exactly one Terminal while the spy was attached.
    const terminal = spy.mock.instances[0] as Terminal;

    spy.mockRestore();
    emulator.setSize({ cols: 20, rows: 5 });
    emulator.write(new TextEncoder().encode("old"));
    emulator.reset();
    emulator.write(new TextEncoder().encode("new"));
    await new Promise<void>((resolve) => terminal.write("", resolve));

    expect(terminal.buffer.active.getLine(0)?.translateToString().trim()).toBe("new");
    emulator.dispose();
  });

  it("u103_the_output_subscription_is_installed_before_the_snapshot_is_asked_for_and_no_output_reaches_the_emulator_before_it", async () => {
    const { app, pending, snapshots, subscriptionsAtSnapshot, log } = await mount();

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    app.emitOutput("t-a", "live");

    expect([subscriptionsAtSnapshot, snapshots()[0]?.params, log()]).toEqual([[1], { id: "t-a" }, []]);
    pending[0]?.(snapshotOf("screen", 0));
    await vi.waitFor(() => expect(log()).toContain("live"));
  });

  it("u103_a_snapshot_that_arrives_after_the_pane_was_shown_refits_the_emulator", async () => {
    const { pending, snapshots, shown, fits } = await mount();

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    expect(shown()).toBe(true);
    pending[0]?.(snapshotOf("screen", 0, { cols: 120, rows: 40 }));

    await vi.waitFor(() => expect(fits()).toBe(1));
  });

  it("u103_the_emulator_is_sized_then_gets_the_data_then_the_buffered_and_later_output_in_order", async () => {
    const { app, pending, snapshots, log } = await mount(undefined, undefined, (fake) => fake.outputPositions.set("t-a", 6));

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    app.emitOutput("t-a", "one");
    app.emitOutput("t-a", "two");
    pending[0]?.(snapshotOf("screen", 6, { cols: 120, rows: 40 }));
    await vi.waitFor(() => expect(log().slice(2).join("")).toBe("onetwo"));
    app.emitOutput("t-a", "three");

    expect(log().slice(0, 2)).toEqual(["size 120x40", "screen"]);
    expect(log().slice(2).join("")).toBe("onetwothree");
  });

  it("u103_output_buffered_during_a_slow_snapshot_stays_bounded_and_resnapshots_after_a_dropped_prefix", async () => {
    const { app, pending, snapshots, log } = await mount();
    const large = "x".repeat(400_000);

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    app.emitOutput("t-a", large);
    app.emitOutput("t-a", large);
    app.emitOutput("t-a", large);
    pending[0]?.(snapshotOf("", 0));

    await vi.waitFor(() => expect(snapshots()).toHaveLength(2));
    pending[1]?.(snapshotOf("complete", large.length * 3));
    await vi.waitFor(() => expect(log().at(-1)).toBe("complete"));
    expect(log().join("")).not.toContain("xx");
  });

  it("u103_an_event_at_or_below_the_snapshot_is_dropped_and_a_straddling_one_keeps_only_its_tail", async () => {
    const { app, pending, snapshots, log } = await mount();

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    app.emitOutput("t-a", "abcd");
    app.emitOutput("t-a", "efgh");
    app.emitOutput("t-a", "ijkl");
    pending[0]?.(snapshotOf("SCREEN", 10));

    await vi.waitFor(() => expect(log()).toEqual(["size 100x30", "SCREEN", "kl"]));
  });

  it("u103_a_gap_requests_a_fresh_snapshot_before_any_later_output", async () => {
    const { app, pending, snapshots, log } = await mount();

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    app.emitGap("t-a", 0, 50);
    app.emitOutput("t-a", "late");
    pending[0]?.(snapshotOf("S", 10));
    await vi.waitFor(() => expect(snapshots()).toHaveLength(2));
    expect(log()).toEqual(["size 100x30", "S"]);
    pending[1]?.(snapshotOf("COMPLETE", 54));
    await vi.waitFor(() => expect(log()).toEqual(["size 100x30", "S", "reset", "size 100x30", "COMPLETE"]));
  });

  it("u103_a_failed_gap_recovery_preserves_the_last_complete_screen_and_shows_one_failure_line", async () => {
    const { app, pending, snapshots, log } = await mount();

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    pending[0]?.(snapshotOf("complete", 8));
    await vi.waitFor(() => expect(log()).toEqual(["size 100x30", "complete"]));
    app.emitGap("t-a", 0, 50);
    app.emitOutput("t-a", "late");
    await vi.waitFor(() => expect(snapshots()).toHaveLength(2));
    await exhaust(pending, 1, "recovery failed");

    expect((await screen.findByRole("alert", { name: /recovery failed/ })).tagName).toBe("P");
    expect(log()).toEqual(["size 100x30", "complete"]);
    expect(screen.getByRole("alert").querySelector('svg.lucide-x[aria-hidden="true"]')).not.toBeNull();
  });

  it("u103_output_overlapping_the_recovery_cut_writes_only_the_remaining_bytes", async () => {
    const { app, pending, snapshots, log } = await mount();

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    pending[0]?.(snapshotOf("old", 8));
    await vi.waitFor(() => expect(log()).toEqual(["size 100x30", "old"]));
    app.emitGap("t-a", 0, 50);
    app.emitOutput("t-a", "abcdef");
    await vi.waitFor(() => expect(snapshots()).toHaveLength(2));
    pending[1]?.(snapshotOf("new", 53));

    await vi.waitFor(() => expect(log()).toEqual(["size 100x30", "old", "reset", "size 100x30", "new", "def"]));
  });

  it("u103_the_pane_still_sends_its_size_to_the_daemon_as_before", async () => {
    const { app, pending, snapshots } = await mount();

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    pending[0]?.(snapshotOf("S", 0));

    await vi.waitFor(() =>
      expect(app.calls.filter((call) => call.method === "terminal.resize")[0]?.params).toEqual({
        id: "t-a",
        cols: 100,
        rows: 30,
      }),
    );
  });

  it("u103_a_failed_snapshot_shows_one_failure_line_and_the_emulator_starts_blank", async () => {
    const { app, pending, snapshots, log } = await mount();

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    await exhaust(pending, 0, "boom");

    expect((await screen.findByRole("alert")).tagName).toBe("P");
    expect(log()).toEqual([]);
    app.emitOutput("t-a", "live");
    expect(log()).toEqual(["live"]);
    expect(screen.getByRole("alert").querySelector('svg.lucide-x[aria-hidden="true"]')).not.toBeNull();
  });

  it("u103_a_late_resize_success_cannot_clear_a_failed_snapshot_line", async () => {
    const resize = Promise.withResolvers<null>();

    const { pending, snapshots, log } = await mount(undefined, undefined, (app) => {
      app.handlers["terminal.resize"] = () => resize.promise;
    });

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    await exhaust(pending, 0, "snapshot failed");
    const snapshotFailure = await screen.findByRole("alert", { name: /snapshot failed/ });
    resize.resolve(null);
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByRole("alert")).toBe(snapshotFailure);
    expect(log()).toEqual([]);
    expect(screen.getByRole("alert").querySelector('svg.lucide-x[aria-hidden="true"]')).not.toBeNull();
  });

  it("u103_a_resolved_newer_resize_failure_reveals_the_older_snapshot_failure", async () => {
    const resizes: ((reply: Error | null) => void)[] = [];

    const { pending, snapshots } = await mount(undefined, undefined, (app) => {
      app.handlers["terminal.resize"] = () => new Promise<null>((resolve, reject) => {
        resizes.push((reply) => reply instanceof Error ? reject(reply) : resolve(null));
      });
    });

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    await vi.waitFor(() => expect(resizes).toHaveLength(1));
    await exhaust(pending, 0, "snapshot failed");
    const snapshotFailure = await screen.findByRole("alert", { name: /snapshot failed/ });
    resizes[0]?.(new Error("resize failed"));
    await screen.findByRole("alert", { name: "resize failed" });

    window.dispatchEvent(new Event("resize"));
    await vi.waitFor(() => expect(resizes).toHaveLength(2));
    resizes[1]?.(null);
    await vi.waitFor(() => expect(screen.getByRole("alert")).toBe(snapshotFailure));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").querySelector('svg.lucide-x[aria-hidden="true"]')).not.toBeNull();
  });

  it("u103_output_buffered_during_a_failed_initial_snapshot_continues_as_live_output", async () => {
    const { app, pending, snapshots, log } = await mount();

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    app.emitOutput("t-a", "live");
    expect(log()).toEqual([]);
    await exhaust(pending, 0, "boom");

    await vi.waitFor(() => expect(log()).toEqual(["live"]));
    app.emitOutput("t-a", "more");
    expect(log()).toEqual(["live", "more"]);
  });

  it("u3791c_a_new_snapshot_failure_replaces_its_original_terminal_target", async () => {
    const { app, connected, pending, snapshots, logOf } = await mount(
      [node("a"), node("b")],
      [info("t-a"), info("t-b")],
    );

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    await exhaust(pending, 0, "A failed");
    await screen.findByRole("alert", { name: /A failed/ });

    connected.rail.select("b");
    await vi.waitFor(() => expect(snapshots()).toHaveLength(3));
    pending[2]?.(snapshotOf("B screen", 0));
    await vi.waitFor(() => expect(logOf("t-b")).toContain("B screen"));
    expect(screen.queryByRole("alert")).toBeNull();

    app.emitGap("t-b", 0, 50);
    await vi.waitFor(() => expect(snapshots()).toHaveLength(4));
    await exhaust(pending, 3, "B failed");
    await screen.findByRole("alert", { name: /B failed/ });

    connected.rail.select("a");
    expect(screen.queryByRole("alert")).toBeNull();
    connected.rail.select("b");
    await screen.findByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").querySelector('svg.lucide-x[aria-hidden="true"]')).not.toBeNull();
  });

  it("u103_nothing_is_typed_for_a_done_agent_and_its_screen_is_still_restored", async () => {
    const { app, pending, snapshots, log } = await mount([agent("a", "done", "finished")]);

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    pending[0]?.(snapshotOf("last screen", 0));

    await vi.waitFor(() => expect(log()).toEqual(["size 100x30", "last screen"]));
    expect(typed(app)).toEqual([]);
  });

  it("u103_nothing_is_typed_for_an_exited_terminal_and_its_screen_is_still_restored", async () => {
    const { app, pending, snapshots, log } = await mount();
    app.emit(event({ name: "terminal.exited", data: { id: "t-a", code: 0 } }));

    await vi.waitFor(() => expect(snapshots()).toHaveLength(1));
    pending[0]?.(snapshotOf("bye", 0));

    await vi.waitFor(() => expect(log()).toEqual(["size 100x30", "bye"]));
    expect(typed(app)).toEqual([]);
  });
});

it.each(["", "later\r\n"])("z3788a_retained_emulator_catches_up_hidden_output_%j", async (hidden) => {
  const { createScreens } = await import("./screens");
  const { app, connected } = await connectFakeProject([node("a")], [info("t-a")]);
  const spy = vi.spyOn(xtermModule, "Terminal");
  const emulator = createXtermEmulators()("t-a");
  const terminal = spy.mock.instances[0];

  if (!terminal) throw new Error("xterm was not created");
  spy.mockRestore();
  // The host has no layout in jsdom; parsing and the stream owner remain real.
  const screens = createScreens(connected, () => ({ ...emulator, show: () => ({ cols: 80, rows: 24 }) }));
  const host = document.createElement("div");
  const parsed = () => new Promise<void>(resolve => emulator.write(new Uint8Array(), resolve));
  screens.show("t-a", host);
  await vi.waitFor(() => expect(app.calls.some(call => call.method === "terminal.snapshot")).toBe(true));
  await parsed();
  const output = "retained history\r\n" + Array.from({ length: 40 }, (_, index) => `${index}\r\n`).join("");
  app.emitOutput("t-a", output);
  await parsed();
  const after = app.outputPositions.get("t-a")!;
  app.handlers["terminal.snapshot"] = () => snapshotOf("current screen only", after);
  const reply = Promise.withResolvers<import("@contracts/terminal/CatchUp").CatchUp>();
  app.handlers["terminal.catchUp"] = () => reply.promise;
  screens.hide("t-a");
  app.emitOutput("t-a", hidden);
  screens.show("t-a", host);
  await vi.waitFor(() => expect(app.calls.filter(call => call.method === "terminal.catchUp")).toHaveLength(1));
  // The subscription precedes catch-up: the reply overlaps the first half of this live chunk.
  app.emitOutput("t-a", "overlap-tail");
  reply.resolve({ kind: "contiguous", id: "t-a", incarnation: "fixture-t-a", from: after,
    after: after + new TextEncoder().encode(hidden + "overlap").length,
    data: toBase64(new TextEncoder().encode(hidden + "overlap")) });
  await vi.waitFor(() => expect(screens.failure("t-a")).toBeNull());
  await parsed();
  expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("retained history");
  const content = Array.from({ length: terminal.buffer.active.length }, (_, i) => terminal.buffer.active.getLine(i)?.translateToString(true)).join("\n");
  expect(content).toContain((hidden + "overlap-tail").replaceAll("\r", ""));
  expect(app.calls.filter(call => call.method === "terminal.snapshot")).toHaveLength(1);
  expect(app.calls.find(call => call.method === "terminal.catchUp")?.params).toEqual({ id: "t-a", incarnation: "fixture-t-a", after });
  expect(typed(app)).toEqual([]);
  screens.dispose();
  connected.stopTerminalScheme();
});

it.each(["gap", "refused", "unavailable"])("z3788a_catch_up_%s_preserves_snapshot_authority", async (result) => {
  const { createScreens } = await import("./screens");
  const { app, connected } = await connectFakeProject([node("a")], [info("t-a")]);
  const { factory, made } = recordingEmulators();
  const screens = createScreens(connected, factory);
  const host = document.createElement("div");
  screens.show("t-a", host);
  await vi.waitFor(() => expect(made.get("t-a")?.log).toContain(""));
  app.emitOutput("t-a", "retained");
  screens.hide("t-a");
  app.emitOutput("t-a", "hidden");
  app.handlers["terminal.snapshot"] = () => {
    if (result === "unavailable") throw new Error("connection closed");

    return snapshotOf("authoritative screen", 14);
  };

  app.handlers["terminal.catchUp"] = ({ id, incarnation }) => {
    if (result !== "gap") throw new Error("original Terminal unavailable");

    return { kind: "gap", id, incarnation, from: 10, after: 14 };
  };

  screens.show("t-a", host);

  if (result === "unavailable") {
    await vi.waitFor(() => expect(screens.failure("t-a")).toContain("connection closed"));
    expect(made.get("t-a")?.log).toEqual(["size 100x30", "", "retained"]);
  } else {
    await vi.waitFor(() => expect(made.get("t-a")?.log.at(-1)).toBe("authoritative screen"));
    expect(made.get("t-a")?.log).toEqual(["size 100x30", "", "retained", "reset", "size 100x30", "authoritative screen"]);
    expect(screens.failure("t-a")).toBeNull();
  }

  expect(typed(app)).toEqual([]);
  screens.dispose();
  connected.stopTerminalScheme();
});

it("z3788a_serialized_scrollback_restores_before_live_output", async () => {
  const { createScreens } = await import("./screens");
  const { app, connected } = await connectFakeProject([node("a")], [info("t-a")]);
  const terminals: Terminal[] = [];
  const emulators: Emulator[] = [];

  const factory: EmulatorFactory = id => {
    const spy = vi.spyOn(xtermModule, "Terminal");
    const emulator = createXtermEmulators()(id);
    const terminal = spy.mock.instances[0];
    spy.mockRestore();

    if (!terminal) throw new Error("xterm was not created");
    terminals.push(terminal);
    emulators.push(emulator);

    return { ...emulator, show: () => ({ cols: 80, rows: 24 }) };
  };

  const parsed = () => new Promise<void>(resolve => emulators.at(-1)!.write(new Uint8Array(), resolve));
  let screens = createScreens(connected, factory);
  const host = document.createElement("div");
  screens.show("t-a", host);
  await vi.waitFor(() => expect(app.calls.filter(call => call.method === "terminal.snapshot")).toHaveLength(1));
  await parsed();
  const output = Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join("") + "\x1b[1;31mwide 世界 " + "wrapped ".repeat(20) + "\x1b[0m";
  app.emitOutput("t-a", output);
  await parsed();
  const { scrollbackStorage } = await import("./scrollback");
  await vi.waitFor(() => expect(scrollbackStorage("/p", "fixture-t-a").read()?.after).toBe(app.outputPositions.get("t-a")), { timeout: 5000 });
  const content = (terminal: Terminal) => Array.from({ length: terminal.buffer.active.length }, (_, i) => terminal.buffer.active.getLine(i)?.translateToString(true));
  const before = content(terminals[0]!);
  const cursor = { x: terminals[0]!.buffer.active.cursorX, y: terminals[0]!.buffer.active.cursorY };
  const after = app.outputPositions.get("t-a")!;
  screens.dispose();
  app.handlers["terminal.snapshot"] = () => snapshotOf("new screen without history", after + 6);
  app.handlers["terminal.catchUp"] = () => ({ kind: "contiguous", id: "t-a", incarnation: "fixture-t-a", from: after, after, data: "" });
  screens = createScreens(connected, factory);
  screens.show("t-a", host);
  await vi.waitFor(() => expect(terminals).toHaveLength(2));
  await vi.waitFor(() => expect(content(terminals[1]!)).toEqual(before));
  expect({ x: terminals[1]!.buffer.active.cursorX, y: terminals[1]!.buffer.active.cursorY }).toEqual(cursor);
  expect(terminals[1]!.buffer.active.getLine(100)?.getCell(0)?.isBold()).toBeTruthy();
  expect(terminals[1]!.buffer.active.getLine(100)?.getCell(0)?.getFgColor()).toBe(1);
  app.emitOutput("t-a", "hidden-tail");
  await parsed();
  expect(content(terminals[1]!).join("\n")).toContain("hidden-tail");
  expect(typed(app)).toEqual([]);
  screens.dispose();
  connected.stopTerminalScheme();
});

it.each(["gap", "refused"])("z3788a_saved_scrollback_%s_uses_the_authoritative_screen", async result => {
  const { scrollbackStorage } = await import("./scrollback");
  const { createScreens } = await import("./screens");
  await scrollbackStorage("/p", "fixture-t-a").write({ cols: 80, rows: 24, after: 0, data: "old history" });
  const { app, connected } = await connectFakeProject([node("a")], [info("t-a")]);
  const { factory, made } = recordingEmulators();
  const screens = createScreens(connected, id => ({ ...factory(id), serialize: () => ({ cols: 80, rows: 24, data: "" }) }));
  app.handlers["terminal.snapshot"] = () => snapshotOf("current authoritative output", 10);
  app.handlers["terminal.catchUp"] = () => {
    if (result === "refused") throw new Error("original Terminal unavailable");

    return { kind: "gap", id: "t-a", incarnation: "fixture-t-a", from: 10, after: 10 };
  };

  screens.show("t-a", document.createElement("div"));
  await vi.waitFor(() => expect(made.get("t-a")?.log).toContain("current authoritative output"));
  expect(made.get("t-a")?.log).not.toContain("old history");
  expect(typed(app)).toEqual([]);
  screens.dispose();
  connected.stopTerminalScheme();
});
