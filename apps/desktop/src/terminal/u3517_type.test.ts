import { afterEach, expect, it, vi } from "vitest";
import * as xterm from "@xterm/xterm";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { FitAddon } from "@xterm/addon-fit";
import { createRoot } from "solid-js";
import tokens from "../tokens.css?inline";
import { xtermOptions, createXtermEmulators } from "./emulator";
import { createScreens } from "./screens";
import { connectFakeProject, callsTo, subscribed } from "./paneHarness";
import { info, terminal } from "../testing/nodes";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); Reflect.deleteProperty(document, "fonts"); });

it("u3517a_font_readiness_preserves_output_and_fits_once_ready", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  let release!: () => void;
  const loading = new Promise<void>(resolve => { release = resolve; });
  Object.defineProperty(document, "fonts", { configurable: true, value: { load: () => loading } });
  const spy = vi.spyOn(xterm, "Terminal");
  const factory = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }));
  const emulator = factory("t-a");
  const real = spy.mock.instances[0]!;
  vi.spyOn(real, "open").mockImplementation(() => {});
  vi.spyOn(real, "element", "get").mockReturnValue(document.createElement("div"));
  // This buffer-only probe closes drawing; the addon requires an opened renderer.
  vi.spyOn(LigaturesAddon.prototype, "activate").mockImplementation(() => {});
  vi.spyOn(real, "registerCharacterJoiner").mockReturnValue(0);
  vi.spyOn(real, "focus").mockImplementation(() => {});
  const fit = vi.spyOn(FitAddon.prototype, "fit").mockImplementation(() => real.resize(60, 25));
  const { app, connected } = await connectFakeProject([terminal("a")], [info("t-a")]);
  const screens = createRoot(() => createScreens(connected, () => emulator));
  screens.resize("t-a", screens.show("t-a", document.createElement("div")));
  await subscribed(app, "t-a");
  app.emitOutput("t-a", "first\r\n" + "second".repeat(12));
  await vi.waitFor(() => expect(real.buffer.active.getLine(1)?.translateToString(true)).toBe("second".repeat(12)));
  expect(callsTo(app, "terminal.resize")).toEqual([]);
  expect(fit).not.toHaveBeenCalled();
  release();
  await vi.waitFor(() => expect(callsTo(app, "terminal.resize")).toEqual([{ id: "t-a", cols: 60, rows: 25 }]));
  expect(real.buffer.active.getLine(0)?.translateToString(true)).toBe("first");
  expect((real.buffer.active.getLine(1)?.translateToString(true) ?? "") + (real.buffer.active.getLine(2)?.translateToString(true) ?? "")).toBe("second".repeat(12));
  expect(callsTo(app, "terminal.write")).toEqual([]);
  screens.dispose();
  Reflect.deleteProperty(document, "fonts");
});

it("u3517c_scheme_changes_reach_open_new_and_unattached_terminals", async () => {
  const { saveAppSettings } = await import("../settings/preferences");
  const { terminalThemeFor } = await import("./theme");
  const { app } = await connectFakeProject([], []);
  const spy = vi.spyOn(xterm, "Terminal");
  const factory = createXtermEmulators();
  const first = factory("first");

  for (const mode of ["dark", "light"] as const) {
    saveAppSettings({ mode });
    const theme = terminalThemeFor();
    await vi.waitFor(() => expect(app.calls.filter(call => call.method === "terminal.scheme").at(-1)?.params).toEqual({ scheme: mode, background: theme.background, foreground: theme.foreground }));
    expect(spy.mock.instances[0]!.options.theme).toMatchObject(theme);
    const next = factory(mode);
    expect(spy.mock.instances.at(-1)!.options.theme).toMatchObject(theme);
    next.dispose();
  }

  first.dispose();
});

it("u4592_terminal_tracking_token", () => {
  expect(/--letter-terminal:\s*([^;]+);/.exec(tokens)?.[1]?.trim()).toBe("0px");
  expect(xtermOptions.letterSpacing).toBe(0);
});
