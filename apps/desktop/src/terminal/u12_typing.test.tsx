import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callsTo, mountPane } from "./paneHarness";
import { event, info, node, terminal } from "../testing/nodes";

const bytes = (...values: number[]) => Uint8Array.from(values);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("u12 typing", () => {
  it("r20_encoding_is_stamped_only_when_the_queued_bytes_are_ready_to_dispatch", async () => {
    const { app, connected, emulators } = await mountPane([terminal("a")], [info("t-a")]);
    const releases: (() => void)[] = [];
    const order: string[] = [];
    const encode = globalThis.btoa;

    vi.spyOn(globalThis, "btoa").mockImplementation((text) => {
      const data = encode(text);

      order.push(`base64:${data}`);

      return data;
    });

    app.handlers["terminal.write"] = ({ data }) => {
      order.push(data);

      return new Promise<null>((resolve) => releases.push(() => resolve(null)));
    };

    connected.rail.select("a");

    const emulator = emulators.get("t-a")!;

    emulator.inputEncoded = () => void order.push("encoded");

    emulator.type(bytes(1));
    emulator.type(bytes(2));
    emulator.type(bytes(3, 4));

    expect(order).toEqual(["base64:AQ==", "encoded", "AQ=="]);
    releases[0]!();
    await vi.waitFor(() => expect(order).toEqual(["base64:AQ==", "encoded", "AQ==", "base64:AgME", "encoded", "AgME"]));
    releases[1]!();
  });

  it("u12_an_exited_terminal_takes_no_input", async () => {
    const { app, connected, emulators } = await mountPane(
      [terminal("a"), terminal("b")],
      [info("t-a", { running: false, exit_code: 0 }), info("t-b")],
    );

    connected.rail.select("a");
    emulators.get("t-a")?.type(bytes(65));
    connected.rail.select("b");
    emulators.get("t-b")?.type(bytes(66));

    await vi.waitFor(() => expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-b", data: "Qg==" }]));
  });

  it("u12_a_terminal_that_exits_while_shown_stops_taking_input", async () => {
    const { app, connected, emulators } = await mountPane([terminal("a"), terminal("b")], [info("t-a"), info("t-b")]);

    connected.rail.select("a");
    app.emit(event({ name: "terminal.exited", data: { id: "t-a", code: 1 } }));
    emulators.get("t-a")?.type(bytes(65));
    connected.rail.select("b");
    emulators.get("t-b")?.type(bytes(66));

    await vi.waitFor(() => expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-b", data: "Qg==" }]));
  });

  it("u12_a_failed_write_shows_its_message", async () => {
    const { app, connected, emulators } = await mountPane([node("a")], [info("t-a")]);

    connected.rail.select("a");
    app.handlers["terminal.write"] = () => {
      throw new Error("conflict: write queue full");
    };

    emulators.get("t-a")?.type(bytes(1));

    expect((await screen.findByRole("alert", { name: "conflict: write queue full" })).className).toBe("ink");
    expect(screen.getByRole("alert").querySelector('svg.lucide-x[aria-hidden="true"]')).not.toBeNull();
  });

  it("u12_a_failed_write_does_not_stall_the_keystrokes_after_it", async () => {
    const { app, connected, emulators } = await mountPane([node("a")], [info("t-a")]);
    let attempts = 0;

    connected.rail.select("a");

    app.handlers["terminal.write"] = () => {
      attempts += 1;

      if (attempts === 1) throw new Error("conflict: write queue full");

      return null;
    };

    emulators.get("t-a")?.type(bytes(1));
    emulators.get("t-a")?.type(bytes(2));

    await vi.waitFor(() => expect(attempts).toBe(2));
  });
});
