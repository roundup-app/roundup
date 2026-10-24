import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as xtermModule from "@xterm/xterm";
import type { Terminal } from "@xterm/xterm";
import type { Snapshot } from "@contracts/terminal/Snapshot";
import { event, info, node } from "../testing/nodes";
import { fromBase64, toBase64 } from "./base64";
import { createXtermEmulators } from "./emulator";
import { connectFakeProject, fakeEmulators, mountPane, subscribed } from "./paneHarness";
import { createScreens } from "./screens";

afterEach(cleanup);

const text = (value: string) => new TextEncoder().encode(value);

const snapshotOf = (value: string, after: number): Snapshot => ({ cols: 100, rows: 30, after, data: toBase64(text(value)) });

const decoded = (chunks: Uint8Array[]): string[] => chunks.map((chunk) => new TextDecoder().decode(chunk));

describe("x14 the App's output subscription", () => {
  it("x14_app_writes_channel_bytes_to_xterm", async () => {
    const { app, connected } = await connectFakeProject([node("a")], [info("t-a")]);
    const spy = vi.spyOn(xtermModule, "Terminal");
    const real = createXtermEmulators();
    // jsdom cannot open an xterm view; an unopened Terminal still takes `write`, which is the call under test.
    const screens = createScreens(connected, (id) => ({ ...real(id), show: () => ({ cols: 80, rows: 24 }) }));

    screens.emulatorFor("t-a");

    // SAFETY: the one Terminal the spy observed is the instance createScreens just constructed for "t-a".
    const terminal = spy.mock.instances[0] as Terminal;

    spy.mockRestore();

    const write = vi.spyOn(terminal, "write");

    screens.show("t-a", document.body.appendChild(document.createElement("div")));
    await subscribed(app, "t-a");
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    write.mockClear();

    // NUL, ESC, bytes that are not UTF-8, then the euro sign (E2 82 AC) split between two chunks.
    const chunks = [Uint8Array.of(0, 27, 91, 49, 109, 255, 254, 128), Uint8Array.of(0xe2, 0x82), Uint8Array.of(0xac)];

    for (const chunk of chunks) app.emitBytes("t-a", chunk);

    expect(write.mock.calls.map(([data]) => data)).toEqual(chunks);
    expect(write.mock.calls.every(([data]) => ArrayBuffer.isView(data))).toBe(true);
    screens.dispose();
  });

  it("x14_app_recovers_a_gap_without_repeating_output", async () => {
    const { app, connected, emulators } = await mountPane([node("a")], [info("t-a")]);
    const replies = [snapshotOf("", 0), snapshotOf("SCREEN", 12)];

    app.handlers["terminal.snapshot"] = () => replies.shift() ?? snapshotOf("unexpected", 0);
    connected.rail.select("a");
    await subscribed(app, "t-a");
    const written = () => decoded(emulators.get("t-a")?.written ?? []);

    await vi.waitFor(() => expect(replies).toHaveLength(1));
    app.emitOutput("t-a", "ab");
    await vi.waitFor(() => expect(written()).toEqual(["ab"]));
    // Bytes 2..10 were not delivered; "late-x" occupies 10..16 and the fresh screen already holds everything before 12.
    app.emitGap("t-a", 2, 10);
    app.emitOutput("t-a", "late-x");
    await vi.waitFor(() => expect(written()).toEqual(["SCREEN", "te-x"]));
    app.emitOutput("t-a", "more");

    expect(written()).toEqual(["SCREEN", "te-x", "more"]);
    expect(app.calls.filter((call) => call.method === "terminal.snapshot")).toHaveLength(2);
    expect(app.outputSubscriptions).toHaveLength(1);
  });

  it("x14_app_disposal_releases_only_its_output_subscription", async () => {
    const { app, connected } = await connectFakeProject([node("a"), node("b")], [info("t-a"), info("t-b")]);
    const { factory, made } = fakeEmulators();
    const screens = createScreens(connected, factory);

    // The Daemon's screen is current up to the bytes its Terminal has printed.
    app.handlers["terminal.snapshot"] = ({ id }) => snapshotOf("", app.outputPositions.get(id) ?? 0);

    const host = () => document.body.appendChild(document.createElement("div"));

    screens.show("t-a", host());
    screens.show("t-b", host());
    await subscribed(app, "t-a");
    await subscribed(app, "t-b");

    const [a, b] = app.outputSubscriptions;
    const written = (id: string) => decoded(made.get(id)?.written ?? []);

    app.emitOutput("t-a", "A1");
    app.emitOutput("t-b", "B1");
    screens.hide("t-a");

    expect([a?.released, b?.released]).toEqual([true, false]);

    // The old callback still exists in the transport; calling it late reaches no xterm.
    a?.listener(text("late"));
    app.emitOutput("t-b", "B2");

    expect([written("t-a"), written("t-b")]).toEqual([["A1"], ["B1", "B2"]]);

    // Replacing the selection: the Terminal shown again has a new subscription, and the old one's late callbacks reach nothing.
    screens.show("t-a", host());
    await vi.waitFor(() => expect(app.outputSubscriptions).toHaveLength(3));
    await vi.waitFor(() => expect(app.calls.filter((call) => call.method === "terminal.snapshot")).toHaveLength(3));
    a?.listener(text("stale"));
    app.emitOutput("t-a", "A2");

    await vi.waitFor(() => expect(written("t-a")).toEqual(["A2"]));

    screens.dispose();
    const [, , again] = app.outputSubscriptions;

    expect([b?.released, again?.released]).toEqual([true, true]);
    b?.listener(text("after dispose"));
    again?.listener(text("after dispose"));
    expect([written("t-a"), written("t-b"), made.get("t-b")?.disposed]).toEqual([["A2"], ["B1", "B2"], true]);
  });

  it("x14_selected_terminal_echo_and_rail_updates_survive_output_flood", async () => {
    const others = Array.from({ length: 10 }, (_, index) => `o${index}`);
    const tree = [node("a"), node("b"), ...others.map((id) => node(id))];
    const terminals = tree.map((each) => info(`t-${each.id}`));
    const { app, connected, emulators } = await mountPane(tree, terminals);
    const statusOf = (id: string) => connected.rail.nodes.find((each) => each.id === id)?.status?.label;

    // The shell echoes what is typed into it.
    app.handlers["terminal.write"] = ({ id, data }) => {
      app.emitBytes(id, fromBase64(data));

      return null;
    };

    connected.rail.select("a");
    await subscribed(app, "t-a");

    const bytesOf = (id: string) => (emulators.get(id)?.written ?? []).reduce((total, chunk) => total + chunk.length, 0);
    const chunk = "x".repeat(1024);

    for (let round = 0; round < 300; round += 1) {
      for (const other of others) app.emitOutput(`t-${other}`, chunk);

      app.emitOutput("t-a", chunk);

      if (round % 50 === 0) {
        app.emit(event({ name: "agent.status", data: { id: "o1", attempt: "1", status_revision: `${round + 2}`, status: { kind: "working", label: `step ${round}`, since: 0, finished: "0" } } }));
      }
    }

    emulators.get("t-a")?.type(text("ls\r"));

    await vi.waitFor(() => expect(bytesOf("t-a")).toBe(300 * 1024 + 3));
    expect([statusOf("o1"), app.outputSubscriptions.map((each) => each.id)]).toEqual(["step 250", ["t-a"]]);
    expect(others.some((other) => emulators.has(`t-${other}`))).toBe(false);

    // Selecting the other Terminal: its echo arrives, the first stops receiving.
    app.handlers["rail.tree"] = () => [...tree, node("later")];
    app.emit(event({ name: "rail.changed" }));
    await vi.waitFor(() => expect(connected.rail.nodes.some((each) => each.id === "later")).toBe(true));
    connected.rail.select("b");
    await subscribed(app, "t-b");
    emulators.get("t-b")?.type(text("pwd\r"));
    app.emitOutput("t-a", "late");

    await vi.waitFor(() => expect(decoded(emulators.get("t-b")?.written ?? [])).toEqual(["pwd\r"]));
    expect([app.outputSubscriptions[0]?.released, bytesOf("t-a")]).toEqual([true, 300 * 1024 + 3]);
  });
});
