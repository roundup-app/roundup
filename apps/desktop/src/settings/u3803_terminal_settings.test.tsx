import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import { FitAddon } from "@xterm/addon-fit";
import * as xtermModule from "@xterm/xterm";
import { info, terminal } from "../testing/nodes";
import { mountPane } from "../terminal/paneHarness";
import { createXtermEmulators } from "../terminal/emulator";
import { applyAppAppearance, saveAppSettings, followAppAppearance, appDark } from "./preferences";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it("u3517d_settings_and_project_zoom_share_the_default", async () => {
  const { connected, emulators } = await mountPane([terminal("a"), terminal("b")], [info("t-a"), info("t-b")]);
  connected.rail.select("a");
  await waitFor(() => expect(emulators.has("t-a")).toBe(true));
  const first = emulators.get("t-a")!;
  await saveAppSettings({ fontSize: 17 });
  await waitFor(() => expect(first.fontSize).toBe(17));
  connected.rail.select("b");
  expect(emulators.get("t-b")!.fontSize).toBe(17);
  expect(first.disposed).toBe(false);
});

it("u3517d_saved_absolute_zoom_survives_default_changes_and_reset", async () => {
  localStorage.setItem("roundup:terminal-font:/p", "19");
  const { connected, emulators, container } = await mountPane([terminal("a")], [info("t-a")]);
  connected.rail.select("a");
  await waitFor(() => expect(emulators.has("t-a")).toBe(true));
  await saveAppSettings({ fontSize: 16 });
  expect(emulators.get("t-a")!.fontSize).toBe(19);
  fireEvent.keyDown(container.querySelector("[data-terminal]")!, { key: "0", code: "Digit0", metaKey: true });
  expect(emulators.get("t-a")!.fontSize).toBe(16);
  await saveAppSettings({ fontSize: 18 });
  await waitFor(() => expect(emulators.get("t-a")!.fontSize).toBe(18));
  cleanup();
  const reopened = await mountPane([terminal("a")], [info("t-a")]);
  reopened.connected.rail.select("a");
  await waitFor(() => expect(reopened.emulators.get("t-a")?.fontSize).toBe(18));
});

it("u4687c_saved_values_reach_existing_and_new_terminals_u3803_font_family_changes_keep_the_same_xterm_and_scrollback", async () => {
  const spy = vi.spyOn(xtermModule, "Terminal");
  const factory = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }));
  const first = factory("first");
  const instance = spy.mock.instances[0]!;
  await new Promise<void>(resolve => first.write(new TextEncoder().encode(`kept output\r\n${"c".repeat(70)}`), resolve));
  await saveAppSettings({ fontFamily: "Menlo", fontWeight: 500, lineHeight: 1.2, letterSpacing: 2 });
  await waitFor(() => expect(instance.options).toMatchObject({ fontFamily: "Menlo", fontWeight: 500, lineHeight: 1.2, letterSpacing: 2 }));
  vi.spyOn(FitAddon.prototype, "fit").mockImplementation(() => instance.resize(60, 24));
  first.fit();
  expect((instance.buffer.active.getLine(1)?.translateToString(true) ?? "") + (instance.buffer.active.getLine(2)?.translateToString(true) ?? "")).toBe("c".repeat(70));
  const second = factory("second");
  await waitFor(() => expect(spy.mock.instances[1]!.options).toMatchObject({ fontFamily: "Menlo", fontWeight: 500, lineHeight: 1.2, letterSpacing: 2 }));
  expect(instance.buffer.active.getLine(0)?.translateToString(true)).toBe("kept output");
  await saveAppSettings({ fontFamily: "" });
  await waitFor(() => expect(instance.options.fontFamily).toContain("monospace"));
  first.dispose();
  second.dispose();
});

it("u3805_dark_and_light_override_the_system_scheme", async () => {
  let dark = false;
  vi.stubGlobal("matchMedia", () => ({ matches: dark }));

  const dispose = createRoot(dispose => { applyAppAppearance();

 return dispose; });

  await saveAppSettings({ mode: "dark" });
  await waitFor(() => expect(document.documentElement.style.colorScheme).toBe("dark"));
  expect(appDark()).toBe(true);
  dark = true;
  await saveAppSettings({ mode: "light" });
  await waitFor(() => expect(document.documentElement.style.colorScheme).toBe("light"));
  expect(appDark()).toBe(false);
  dispose();
});

it("u3805_system_follows_a_change_of_the_media_query", async () => {
  const query = new EventTarget();
  Object.assign(query, { matches: false });
  vi.stubGlobal("matchMedia", () => query);
  await saveAppSettings({ mode: "system" });
  const observed: boolean[] = [];
  const stop = followAppAppearance(() => observed.push(appDark()));
  Object.assign(query, { matches: true });
  query.dispatchEvent(new Event("change"));
  Object.assign(query, { matches: false });
  query.dispatchEvent(new Event("change"));
  expect(observed).toEqual([true, false]);
  stop();
  query.dispatchEvent(new Event("change"));
  expect(observed).toHaveLength(2);
});

it("u4687d_visibility_keeps_focus_input_and_resize_behavior", async () => {
  const { app, connected, emulators } = await mountPane([terminal("a")], [info("t-a")]);
  connected.rail.select("a");
  await waitFor(() => expect(emulators.has("t-a")).toBe(true));
  const emulator = emulators.get("t-a")!;
  const focused = document.activeElement;
  const fits = emulator.fits;
  const calls = app.calls.length;
  await saveAppSettings({ focusMarkers: false });
  await saveAppSettings({ focusMarkers: true });
  expect(document.activeElement).toBe(focused);
  expect(emulator.fits).toBe(fits);
  expect(app.calls.slice(calls).filter(call => ["terminal.resize", "terminal.write", "agent.spawn", "rail.startDoor"].includes(call.method))).toEqual([]);
  emulator.type(new TextEncoder().encode("kept input"));
  await waitFor(() => expect(app.calls.some(call => call.method === "terminal.write")).toBe(true));
});
