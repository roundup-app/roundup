import { expect, it, vi } from "vitest";
import { node, info, terminal } from "../testing/nodes";
import { fromBase64 } from "./base64";
import { connectFakeProject, fakeEmulators, subscribed } from "./paneHarness";
import { createScreens } from "./screens";
import * as xtermModule from "@xterm/xterm";
import { createXtermEmulators } from "./emulator";

it.each([node("a"), terminal("a")])("r21_agent_and_terminal_share_the_repaired_input_path ($status)", async (item) => {
  const { app, connected } = await connectFakeProject([item, node("flood")], [info("t-a"), info("t-flood")]);
  const { factory, made } = fakeEmulators();
  const parsed: (() => void)[] = [];

  const screens = createScreens(connected, (id) => {
    const emulator = factory(id);
    const write = emulator.write;

    return { ...emulator, write: (bytes, done) => {
      write(bytes);

      if (bytes.length && id === "t-flood") parsed.push(() => done?.());
      else done?.();
    } };
  });

  const host = () => document.body.appendChild(document.createElement("div"));

  try {
    screens.show("t-flood", host());
    screens.show("t-a", host());
    await subscribed(app, "t-a");
    await vi.waitFor(() => expect(app.calls.filter(call => call.method === "terminal.snapshot")).toHaveLength(2));
    const replies: (() => void)[] = [];
    const input: string[] = [];

    app.handlers["terminal.write"] = ({ id, data }) => {
      const text = new TextDecoder().decode(fromBase64(data));

      input.push(text);
      app.emitOutput(id, text);

      return new Promise<null>(resolve => replies.push(() => resolve(null)));
    };

    app.emitOutput("t-flood", "first");
    app.emitOutput("t-flood", "second");
    app.emitOutput("t-flood", "third");
    made.get("t-a")!.type(new TextEncoder().encode("a"));
    made.get("t-a")!.type(new TextEncoder().encode("bc"));
    expect(input).toEqual(["a"]);
    replies.shift()!();
    await vi.waitFor(() => expect(input).toEqual(["a", "bc"]));
    expect(made.get("t-a")!.written.map(bytes => new TextDecoder().decode(bytes))).toEqual(["a", "bc"]);
    expect(made.get("t-flood")!.written.map(bytes => new TextDecoder().decode(bytes))).toEqual(["first"]);
    parsed.shift()!();
    await vi.waitFor(() => expect(made.get("t-flood")!.written).toHaveLength(2));
    expect(made.get("t-flood")!.written.map(bytes => new TextDecoder().decode(bytes))).toEqual(["first", "secondthird"]);
    replies.shift()!();
  } finally {
    screens.dispose();
    document.body.replaceChildren();
  }
});

it("r21_backlogged_output_yields_to_each_display_frame", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "requestAnimationFrame", "cancelAnimationFrame"] });

  const { app, connected } = await connectFakeProject([node("flood")], [info("t-flood")]);
  const { factory, made } = fakeEmulators();

  const screens = createScreens(connected, (id) => {
    const emulator = factory(id);
    const write = emulator.write;

    return { ...emulator, write: (bytes, done) => {
      write(bytes);

      if (!bytes.length) return done?.();
      // Each chunk takes 6 ms to parse.
      setTimeout(() => done?.(), 6);
    } };
  });

  try {
    screens.show("t-flood", document.body.appendChild(document.createElement("div")));
    await subscribed(app, "t-flood");
    await vi.waitFor(() => expect(app.calls.filter(call => call.method === "terminal.snapshot")).toHaveLength(1));
    // Start just after a frame so both six-ms intervals precede the next one.
    await vi.advanceTimersToNextFrame();
    app.emitOutput("t-flood", "one");
    app.emitOutput("t-flood", "two");
    app.emitOutput("t-flood", "three");
    const chunks = () => made.get("t-flood")!.written.map(bytes => new TextDecoder().decode(bytes));

    expect(chunks()).toEqual(["one"]);
    await vi.advanceTimersByTimeAsync(6);
    expect(chunks()).toEqual(["one"]);
    // Timer turns before the next display frame must not restart the flood.
    await vi.advanceTimersByTimeAsync(6);
    expect(chunks()).toEqual(["one"]);
    await vi.advanceTimersToNextFrame();
    expect(chunks()).toEqual(["one", "twothree"]);
  } finally {
    screens.dispose();
    document.body.replaceChildren();
    vi.useRealTimers();
  }
});

it("r21_flood_chunks_shrink_to_a_parse_the_echo_can_wait_behind", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "requestAnimationFrame", "cancelAnimationFrame"] });

  const { app, connected } = await connectFakeProject([node("flood")], [info("t-flood")]);
  const { factory, made } = fakeEmulators();

  const screens = createScreens(connected, (id) => {
    const emulator = factory(id);
    const write = emulator.write;

    return { ...emulator, write: (bytes, done) => {
      write(bytes);

      if (!bytes.length) return done?.();
      // Parsing runs at 1000 bytes per ms.
      setTimeout(() => done?.(), bytes.length / 1000);
    } };
  });

  try {
    screens.show("t-flood", document.body.appendChild(document.createElement("div")));
    await subscribed(app, "t-flood");
    await vi.waitFor(() => expect(app.calls.filter(call => call.method === "terminal.snapshot")).toHaveLength(1));
    app.emitOutput("t-flood", "x".repeat(8192));

    // Cross event boundaries, including a partially consumed event, in later chunks.
    for (let offset = 8192; offset < 20_000; offset += 1024) {
      app.emitOutput("t-flood", "x".repeat(Math.min(1024, 20_000 - offset)));
    }

    await vi.advanceTimersByTimeAsync(200);
    const sizes = made.get("t-flood")!.written.map(bytes => bytes.length);

    expect(sizes[0]).toBe(8192);
    expect(sizes.slice(1, -1).every(size => size >= 1500 && size <= 2500)).toBe(true);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(20_000);
  } finally {
    screens.dispose();
    document.body.replaceChildren();
    vi.useRealTimers();
  }
});


it("r21_flood_gutters_draw_once_per_frame_without_losing_turn_selection", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  const created = vi.spyOn(xtermModule, "Terminal");
  const emulator = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }))("flood");
  const terminal = created.mock.instances[0]!;
  const host = document.body.appendChild(document.createElement("div"));
  const write = (text: string) => new Promise<void>(resolve => emulator.write(new TextEncoder().encode(text), resolve));

  try {
    emulator.show(host, false);
    terminal.resize(80, 5);
    await write("\x1b]133;A\x07$ yes\x1b]133;C\x07\r\n");
    vi.advanceTimersToNextFrame();
    const screen = host.querySelector<HTMLElement>(".xterm-screen")!;
    const reads = vi.spyOn(screen, "clientHeight", "get").mockReturnValue(100);
    const output = Array.from({ length: 200 }, (_, i) => `flood ${i}\r\n`).join("");

    await write(output);
    // xterm's render event, rather than each scrolled row or parse callback,
    // owns the gutter's layout read and writes.
    expect(reads).not.toHaveBeenCalled();
    vi.advanceTimersToNextFrame();
    expect(reads).toHaveBeenCalledTimes(1);
    host.querySelector<HTMLButtonElement>(".turn-gutter")!.click();
    expect(emulator.selection()).toBe("$ yes\n" + output.replaceAll("\r", "").trimEnd());
  } finally {
    emulator.dispose();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
