import { afterEach, expect, it, vi } from "vitest";
import * as xterm from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { createRoot } from "solid-js";
import { createXtermEmulators } from "./emulator";
import { createScreens } from "./screens";
import { connectFakeProject, callsTo, subscribed } from "./paneHarness";
import { info, terminal } from "../testing/nodes";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it("u3517a_font_readiness_preserves_output_and_fits_once_ready", async () => {
  let release!: () => void;
  const loading = new Promise<void>(resolve => { release = resolve; });
  Object.defineProperty(document, "fonts", { configurable: true, value: { load: () => loading } });
  const spy = vi.spyOn(xterm, "Terminal");
  const factory = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }));
  const emulator = factory("t-a");
  const real = spy.mock.instances[0]!;
  vi.spyOn(real, "open").mockImplementation(() => {});
  vi.spyOn(real, "focus").mockImplementation(() => {});
  const fit = vi.spyOn(FitAddon.prototype, "fit").mockImplementation(() => real.resize(90, 25));
  const { app, connected } = await connectFakeProject([terminal("a")], [info("t-a")]);
  const screens = createRoot(() => createScreens(connected, () => emulator));
  screens.resize("t-a", screens.show("t-a", document.createElement("div")));
  await subscribed(app, "t-a");
  app.emitOutput("t-a", "first\r\nsecond");
  await vi.waitFor(() => expect(real.buffer.active.getLine(1)?.translateToString(true)).toBe("second"));
  expect(callsTo(app, "terminal.resize")).toEqual([]);
  expect(fit).not.toHaveBeenCalled();
  release();
  await vi.waitFor(() => expect(callsTo(app, "terminal.resize")).toEqual([{ id: "t-a", cols: 90, rows: 25 }]));
  expect(real.buffer.active.getLine(0)?.translateToString(true)).toBe("first");
  expect(real.buffer.active.getLine(1)?.translateToString(true)).toBe("second");
  expect(callsTo(app, "terminal.write")).toEqual([]);
  screens.dispose();
  Reflect.deleteProperty(document, "fonts");
});
