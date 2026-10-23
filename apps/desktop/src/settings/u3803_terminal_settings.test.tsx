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

it("u3803_a_commit_applies_to_open_and_new_terminals", async () => {
  const { connected, emulators } = await mountPane([terminal("a"), terminal("b")], [info("t-a"), info("t-b")]);
  connected.rail.select("a");
  await waitFor(() => expect(emulators.has("t-a")).toBe(true));
  const first = emulators.get("t-a")!;
  saveAppSettings({ fontSize: 17 });
  await waitFor(() => expect(first.fontSize).toBe(17));
  connected.rail.select("b");
  expect(emulators.get("t-b")!.fontSize).toBe(17);
  expect(first.disposed).toBe(false);
});

it("u3803_a_per_terminal_zoom_still_wins", async () => {
  localStorage.setItem("roundup:terminal-font:/p", "19");
  const { connected, emulators, container } = await mountPane([terminal("a")], [info("t-a")]);
  connected.rail.select("a");
  await waitFor(() => expect(emulators.has("t-a")).toBe(true));
  saveAppSettings({ fontSize: 16 });
  expect(emulators.get("t-a")!.fontSize).toBe(19);
  fireEvent.keyDown(container.querySelector("[data-terminal]")!, { key: "0", code: "Digit0", metaKey: true });
  expect(emulators.get("t-a")!.fontSize).toBe(16);
  saveAppSettings({ fontSize: 18 });
  await waitFor(() => expect(emulators.get("t-a")!.fontSize).toBe(18));
  cleanup();
  const reopened = await mountPane([terminal("a")], [info("t-a")]);
  reopened.connected.rail.select("a");
  await waitFor(() => expect(reopened.emulators.get("t-a")?.fontSize).toBe(18));
});

it("u3803_font_family_changes_keep_the_same_xterm_and_scrollback", async () => {
  const spy = vi.spyOn(xtermModule, "Terminal");
  const factory = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }));
  const first = factory("first");
  const instance = spy.mock.instances[0]!;
  await new Promise<void>(resolve => first.write(new TextEncoder().encode(`kept output\r\n${"c".repeat(70)}`), resolve));
  saveAppSettings({ fontFamily: "Menlo" });
  await waitFor(() => expect(instance.options.fontFamily).toBe("Menlo"));
  vi.spyOn(FitAddon.prototype, "fit").mockImplementation(() => instance.resize(60, 24));
  first.fit();
  expect((instance.buffer.active.getLine(1)?.translateToString(true) ?? "") + (instance.buffer.active.getLine(2)?.translateToString(true) ?? "")).toBe("c".repeat(70));
  const second = factory("second");
  await waitFor(() => expect(spy.mock.instances[1]!.options.fontFamily).toBe("Menlo"));
  expect(instance.buffer.active.getLine(0)?.translateToString(true)).toBe("kept output");
  saveAppSettings({ fontFamily: "" });
  await waitFor(() => expect(instance.options.fontFamily).toContain("monospace"));
  first.dispose();
  second.dispose();
});

it("u3805_dark_and_light_override_the_system_scheme", async () => {
  let dark = false;
  vi.stubGlobal("matchMedia", () => ({ matches: dark }));

  const dispose = createRoot(dispose => { applyAppAppearance();

 return dispose; });

  saveAppSettings({ mode: "dark" });
  await waitFor(() => expect(document.documentElement.style.colorScheme).toBe("dark"));
  expect(appDark()).toBe(true);
  dark = true;
  saveAppSettings({ mode: "light" });
  await waitFor(() => expect(document.documentElement.style.colorScheme).toBe("light"));
  expect(appDark()).toBe(false);
  dispose();
});

it("u3805_system_follows_a_change_of_the_media_query", () => {
  const query = new EventTarget();
  Object.assign(query, { matches: false });
  vi.stubGlobal("matchMedia", () => query);
  saveAppSettings({ mode: "system" });
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

it("u3805_open_terminals_take_the_new_theme", async () => {
  const spy = vi.spyOn(xtermModule, "Terminal");
  const emulator = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }))("theme");
  const instance = spy.mock.instances[0]!;
  saveAppSettings({ mode: "dark" });
  await waitFor(() => expect(instance.options.theme?.background).toBe("#1c1c1e"));
  saveAppSettings({ mode: "light" });
  await waitFor(() => expect(instance.options.theme?.background).toBe("#ffffff"));
  emulator.dispose();
});
