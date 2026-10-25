import * as xtermModule from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { createRoot } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { createXtermEmulators } from "./emulator";
import { createScreens } from "./screens";
import { callsTo, connectFakeProject } from "./paneHarness";
import { info, node, workstream } from "../testing/nodes";

const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).reverse().forEach(stop => stop());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["Agent", "Door", "Bubble"])("s3806c_scale_change_refits_the_terminal %s", async (hostKind) => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  vi.stubGlobal("devicePixelRatio", 2);
  const media = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addListener: (listener: () => void) => media.add(listener),
    removeListener: (listener: () => void) => media.delete(listener),
    addEventListener() {}, removeEventListener() {},
  }));
  // Only the measurement boundary is doubled; real xterm owns DPR notifications and redraw.
  let cols = 100;
  let rows = 30;
  vi.spyOn(FitAddon.prototype, "proposeDimensions").mockImplementation(() => ({ cols, rows }));
  const created = vi.spyOn(xtermModule, "Terminal");
  const tree = hostKind === "Door" ? [workstream("a")] : hostKind === "Agent" ? [node("a")] : [];
  const { app, connected } = await connectFakeProject(tree, [info("t-a")]);
  let stop = () => {};
  const screens = createRoot(dispose => {
    stop = dispose;
    return createScreens(connected, createXtermEmulators(undefined, () => {
      throw new Error("No WebGL in the portable observer");
    }));
  });
  stops.push(stop, () => screens.dispose());
  const host = document.createElement("div");
  document.body.append(host);
  stops.push(() => host.remove());
  const size = screens.show("t-a", host, false);
  screens.resize("t-a", size);
  const terminal = created.mock.instances[0];
  if (!terminal) throw new Error("xterm not created");
  // Keep the initial snapshot out of the scale sequence.
  await vi.waitFor(() => expect(app.calls.some(call => call.method === "terminal.snapshot")).toBe(true));
  await new Promise<void>(resolve => terminal.write("", resolve));
  vi.advanceTimersToNextFrame();
  app.calls.length = 0;
  const output = Array.from({ length: 60 }, (_, i) => `output ${i}`).join("\r\n");
  await new Promise<void>(resolve => screens.emulatorFor("t-a").write(new TextEncoder().encode(output), resolve));
  terminal.select(0, 0, 6);
  terminal.scrollToLine(5);
  const selection = terminal.getSelection();
  const content = () => Array.from({ length: terminal.buffer.active.length }, (_, i) => terminal.buffer.active.getLine(i)?.translateToString(true)).filter(Boolean);
  const before = content();
  const render = vi.fn();
  terminal.onRender(render);
  const notify = (dpr: number) => {
    vi.stubGlobal("devicePixelRatio", dpr);
    [...media].forEach(listener => listener());
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
  };
  notify(1);
  expect(render).toHaveBeenCalled();
  expect(callsTo(app, "terminal.resize")).toEqual([]);
  cols = 90; rows = 25;
  notify(2);
  expect(callsTo(app, "terminal.resize")).toEqual([{ id: "t-a", cols: 90, rows: 25 }]);
  notify(2);
  expect(callsTo(app, "terminal.resize")).toHaveLength(1);
  expect(content()).toEqual(before);
  expect(terminal.getSelection()).toBe(selection);
  expect(terminal.buffer.active.viewportY).toBe(5);
  expect(callsTo(app, "terminal.write")).toEqual([]);
  expect(created).toHaveBeenCalledTimes(1);
  screens.hide("t-a");
  cols = 80; rows = 20;
  notify(1);
  expect(callsTo(app, "terminal.resize")).toHaveLength(1);
  const revealed = screens.show("t-a", host, false);
  screens.resize("t-a", revealed);
  expect(revealed).toEqual({ cols: 80, rows: 20 });
  expect(callsTo(app, "terminal.resize").at(-1)).toEqual({ id: "t-a", cols: 80, rows: 20 });
  screens.dispose();
  const count = app.calls.length;
  notify(2);
  expect(app.calls).toHaveLength(count);
});
