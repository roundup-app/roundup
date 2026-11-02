import * as xtermModule from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { createComponent, createSignal } from "solid-js";
import { render } from "@solidjs/testing-library";
import { ConnectedProjectContext } from "../state/connectedProject";
import { Pane } from "./Pane";
import { Bubble } from "../bubbles/Bubble";
import { saveAppSettings } from "../settings/preferences";
import type { Screens } from "./screens";
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
  localStorage.clear();
});

it.each(["Agent", "Door", "Bubble"].flatMap(host => [false, true].map(webgl => ({ host, webgl }))))(
"s3806c_scale_change_refits_the_terminal $host webgl=$webgl", async ({ host: hostKind, webgl }) => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  vi.stubGlobal("devicePixelRatio", 2);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("xterm-char-measure-element") ? 256 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("xterm-char-measure-element") ? 16 : 0;
  });
  const hostObservers = new Set<() => void>();
  vi.stubGlobal("ResizeObserver", class {
    constructor(private changed: () => void) {}
    observe() { hostObservers.add(this.changed); }
    unobserve() { hostObservers.delete(this.changed); }
    disconnect() { hostObservers.delete(this.changed); }
  });
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
  const tree = hostKind === "Door" ? [workstream("a", { terminal_id: "t-a" })] : hostKind === "Agent" ? [node("a")] : [];
  const { app, connected } = await connectFakeProject(tree, [info("t-a")]);
  const invalidations: number[] = [];

  const factory = createXtermEmulators(undefined, () => ({
    activate(terminal) {
      if (!webgl) throw new Error("WebGL refused");

      // SAFETY: xterm 6's addon seam installs a renderer on this service (WebglAddon.activate).
      // Only drawing is doubled: xterm owns DPR subscriptions, invalidation, render scheduling and fit.
      const core = (terminal as xtermModule.Terminal & { _core: { _renderService: {
        dimensions: Record<string, Record<string, { width: number; height: number }>>;
        setRenderer(renderer: {
          dimensions: Record<string, Record<string, { width: number; height: number }>>;
          onRequestRedraw(): { dispose(): void };
          handleDevicePixelRatioChange(): void;
          renderRows(): void; clear(): void; dispose(): void; handleResize(): void;
          handleCharSizeChanged(): void; handleBlur(): void; handleFocus(): void;
          handleSelectionChanged(): void; handleCursorMove(): void;
        }): void;
      } } })._core;

      core._renderService.setRenderer({
        dimensions: core._renderService.dimensions,
        onRequestRedraw() { return { dispose() {} }; },
        handleDevicePixelRatioChange() { invalidations.push(window.devicePixelRatio); },
        renderRows() {}, clear() {}, dispose() {}, handleResize() {}, handleCharSizeChanged() {},
        handleBlur() {}, handleFocus() {}, handleSelectionChanged() {}, handleCursorMove() {},
      });
    },
    dispose() {},
    onContextLoss() { return { dispose() {} }; },
  }));

  const [place, setPlace] = createSignal({ x: 0, y: 0, w: 800, h: 500, min: false });
  let screens!: Screens;

  const mounted = render(() => {
    if (hostKind !== "Bubble") return createComponent(ConnectedProjectContext.Provider, {
      value: connected,
      get children() { return createComponent(Pane, { createEmulator: factory, screensRef: value => { screens = value; } }); },
    });

    screens = createScreens(connected, factory);

    return createComponent(Bubble, {
      id: "t-a", screens, name: "Shell", get place() { return place(); },
      origin: { left: 0, top: 0 }, extent: () => ({ width: 1000, height: 800 }),
      setPlace() {}, readOnly: () => false, close: async () => {}, menu() {}, toggleMinimised() {},
    });
  });

  stops.push(() => screens.dispose(), mounted.unmount);

  if (hostKind !== "Bubble") connected.rail.select("a");
  const host = document.querySelector<HTMLElement>(".pane-screen, .bubble-body");

  if (!host) throw new Error("Terminal host not mounted");
  const terminal = created.mock.instances[0];

  if (!terminal) throw new Error("xterm not created");
  // Keep the initial snapshot out of the scale sequence.
  await vi.waitFor(() => expect(app.calls.some(call => call.method === "terminal.snapshot")).toBe(true));
  await new Promise<void>(resolve => terminal.write("", resolve));
  vi.advanceTimersToNextFrame();
  app.calls.length = 0;
  const output = Array.from({ length: 60 }, (_, i) => `output ${i}`).join("\r\n") + "日本語🙂x".repeat(30);
  await new Promise<void>(resolve => screens.emulatorFor("t-a").write(new TextEncoder().encode(output), resolve));
  terminal.select(4, 59, 130);
  terminal.scrollToLine(5);
  const selection = terminal.getSelection();

  const content = () => {
    const lines: string[] = [];

    for (let i = 0; i < terminal.buffer.active.length; i += 1) {
      const line = terminal.buffer.active.getLine(i)!;
      const text = line.translateToString(true);

      if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
      else if (text) lines.push(text);
    }

    return lines;
  };

  const before = content();
  const rendered = vi.fn();
  terminal.onRender(rendered);

  const notify = (dpr: number) => {
    vi.stubGlobal("devicePixelRatio", dpr);
    [...media].forEach(listener => listener());
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
  };

  vi.advanceTimersToNextFrame();
  vi.advanceTimersToNextFrame();
  rendered.mockClear();
  notify(1);
  expect(rendered).toHaveBeenCalled();

  if (webgl) expect(invalidations).toEqual([1]);
  expect(callsTo(app, "terminal.resize")).toEqual([]);
  cols = 90; rows = 25;
  notify(2);
  expect(callsTo(app, "terminal.resize")).toEqual([{ id: "t-a", cols: 90, rows: 25 }]);
  notify(2);
  expect(callsTo(app, "terminal.resize")).toHaveLength(1);
  // Host-only and font-family changes do not require a DPR notification.
  cols = 85;
  [...hostObservers].forEach(changed => changed());
  vi.advanceTimersToNextFrame();
  expect(callsTo(app, "terminal.resize").at(-1)).toEqual({ id: "t-a", cols: 85, rows: 25 });
  cols = 82;
  saveAppSettings({ fontFamily: "monospace" });
  vi.advanceTimersToNextFrame();
  expect(callsTo(app, "terminal.resize").at(-1)).toEqual({ id: "t-a", cols: 82, rows: 25 });
  expect(content()).toEqual(before);
  expect(terminal.getSelection()).toBe(selection);
  expect(terminal.buffer.active.viewportY).toBe(5);
  expect(callsTo(app, "terminal.write")).toEqual([]);
  expect(created).toHaveBeenCalledTimes(1);
  expect(app.calls.filter(call => call.method === "terminal.spawn" || call.method === "terminal.open")).toEqual([]);

  if (hostKind === "Bubble") setPlace({ ...place(), min: true });
  else connected.rail.select(null);
  cols = 80; rows = 20;
  notify(1);
  expect(callsTo(app, "terminal.resize")).toHaveLength(3);

  const focused: { cols: number; rows: number }[] = [];

  const focus = terminal.focus.bind(terminal);
  vi.spyOn(terminal, "focus").mockImplementation(() => { focused.push({ cols: terminal.cols, rows: terminal.rows }); focus(); });

  if (hostKind === "Bubble") {
    setPlace({ ...place(), min: false });
    // Input can arrive before Bubble's queued frame. Its resize must already precede this deliberate input.
    terminal.focus();
    terminal.input("resume", true);
    expect(app.calls.filter(call => call.method === "terminal.resize" || call.method === "terminal.write").slice(-2).map(call => call.method))
      .toEqual(["terminal.resize", "terminal.write"]);
  } else {
    connected.rail.select("a");
    expect(focused).toEqual([{ cols: 80, rows: 20 }]);
  }

  vi.advanceTimersToNextFrame();
  expect({ cols: terminal.cols, rows: terminal.rows }).toEqual({ cols: 80, rows: 20 });
  expect(callsTo(app, "terminal.resize").at(-1)).toEqual({ id: "t-a", cols: 80, rows: 20 });
  mounted.unmount();
  screens.dispose();
  const count = app.calls.length;
  notify(2);
  expect(app.calls).toHaveLength(count);
  expect(invalidations).toEqual(webgl ? [1, 2, 1] : []);
});
