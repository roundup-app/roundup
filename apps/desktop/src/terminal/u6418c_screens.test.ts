import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import type { DaemonExit } from "../app/seam";
import { createScreens } from "./screens";
import { connectFakeProject, callsTo, fakeEmulators } from "./paneHarness";
import type { Size } from "./emulator";
import { scrollbackStorage } from "./scrollback";
import { info, node } from "../testing/nodes";

const PANE: Size = { cols: 146, rows: 40 };

const NARROW: Size = { cols: 41, rows: 40 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A Terminal whose host fits PANE however its emulator was last sized, as a settled layout does. */
const mount = async (daemonExit: () => DaemonExit | null = () => null) => {
  const { app, connected } = await connectFakeProject([node("a")], [info("t-a")], 0, daemonExit);
  const { factory, made } = fakeEmulators();
  const screens = createRoot(() => createScreens(connected, factory));

  screens.emulatorFor("t-a");

  const fake = made.get("t-a");

  if (!fake) throw new Error("the Terminal's emulator was not made");

  fake.show = (host) => {
    fake.host = host;
    fake.size = PANE;

    return PANE;
  };

  fake.fit = () => {
    fake.size = PANE;

    return PANE;
  };

  return { app, connected, screens };
};

const lastResize = (app: Parameters<typeof callsTo>[0]) => callsTo(app, "terminal.resize").at(-1);

describe("u6418c a shown Terminal's PTY size equals its fit", () => {
  it("u6418c_a_reload_restoring_narrow_saved_scrollback_ends_at_the_fit", async () => {
    const { app, connected, screens } = await mount();
    const incarnation = connected.rail.terminals().find(t => t.id === "t-a")?.incarnation;

    if (incarnation) await scrollbackStorage("/p", incarnation).write({ ...NARROW, after: 0, data: "" }, null);

    screens.show("t-a", document.createElement("div"));
    await vi.advanceTimersByTimeAsync(50);
    vi.advanceTimersToNextFrame();

    expect(lastResize(app)).toEqual({ id: "t-a", ...PANE });
  });

  it("u6418c_a_snapshot_reporting_a_narrower_pty_ends_at_the_fit", async () => {
    const { app, screens } = await mount();

    app.handlers["terminal.snapshot"] = () => ({ ...NARROW, after: 0, data: "" });
    screens.resize("t-a", PANE);
    app.calls.length = 0;
    screens.show("t-a", document.createElement("div"));
    await vi.advanceTimersByTimeAsync(50);
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();

    expect(lastResize(app)).toEqual({ id: "t-a", ...PANE });
  });

  it("u6418c_a_resize_during_a_daemon_outage_is_sent_when_it_returns", async () => {
    const [exit, setExit] = createSignal<DaemonExit | null>({ code: 1 });
    const { app, screens } = await mount(exit);

    screens.resize("t-a", PANE);
    expect(callsTo(app, "terminal.resize")).toEqual([]);

    setExit(null);
    screens.resize("t-a", PANE);

    expect(lastResize(app)).toEqual({ id: "t-a", ...PANE });
  });
});
