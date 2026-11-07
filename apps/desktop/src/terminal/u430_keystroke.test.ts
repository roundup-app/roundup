import { afterEach, expect, it, vi } from "vitest";
import * as xterm from "@xterm/xterm";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { FitAddon } from "@xterm/addon-fit";
import { createRoot } from "solid-js";
import { createXtermEmulators } from "./emulator";
import { createScreens } from "./screens";
import { connectFakeProject, callsTo, subscribed } from "./paneHarness";
import { info, terminal } from "../testing/nodes";
import { setDrawerSliding } from "../drawer/sliding";
import { setShelfSliding } from "../shelf/sliding";
import { setResizeDragging } from "../resize/dragging";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); Reflect.deleteProperty(document, "fonts"); });

type Core = { _core: { coreService: { triggerBinaryEvent(data: string): void } } };

const hasCore = (term: xterm.Terminal): term is xterm.Terminal & Core => "_core" in term;

it("u430_a_keystroke_during_a_slide_sends_no_resize", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(document, "fonts", { configurable: true, value: { load: () => Promise.resolve() } });
  const spy = vi.spyOn(xterm, "Terminal");
  const factory = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }));
  const emulator = factory("t-a");
  const real = spy.mock.instances.at(0);

  if (!real) throw new Error("no xterm Terminal was built");

  const host = document.createElement("div");
  const element = document.createElement("div");
  host.append(element);
  vi.spyOn(real, "open").mockImplementation(() => {});
  vi.spyOn(real, "element", "get").mockReturnValue(element);
  vi.spyOn(LigaturesAddon.prototype, "activate").mockImplementation(() => {});
  vi.spyOn(real, "registerCharacterJoiner").mockReturnValue(0);
  vi.spyOn(real, "focus").mockImplementation(() => {});
  let cols = 60;
  vi.spyOn(FitAddon.prototype, "fit").mockImplementation(() => real.resize(cols, 25));
  vi.spyOn(FitAddon.prototype, "proposeDimensions").mockImplementation(() => ({ cols, rows: 25 }));
  const { app, connected } = await connectFakeProject([terminal("a")], [info("t-a")]);
  const screens = createRoot(() => createScreens(connected, () => emulator));
  screens.resize("t-a", screens.show("t-a", host));
  await subscribed(app, "t-a");
  await vi.waitFor(() => expect(callsTo(app, "terminal.resize")).toHaveLength(1));
  await new Promise(resolve => setTimeout(resolve, 50));
  const before = callsTo(app, "terminal.resize").length;

  for (const set of [setResizeDragging, setDrawerSliding, setShelfSliding]) {
    set(true);
    cols += 5;
    real.input("x", true);

    if (!hasCore(real)) throw new Error("xterm hides its core service");
    real._core.coreService.triggerBinaryEvent("\x1b[M");

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(callsTo(app, "terminal.resize")).toHaveLength(before);
    set(false);
  }

  screens.dispose();
});
