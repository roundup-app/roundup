import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, expect, it } from "vitest";
import { createTauriApp } from "./tauri";
import type { MenuBarAction, MenuBar } from "./seam";

afterEach(clearMocks);

it("u5502_the_app_seam_keeps_original_menu_identities", async () => {
  const sent: unknown[] = [];
  const heard: MenuBarAction[] = [];
  const windowCalls: string[] = [];
  mockWindows("main");
  mockIPC((command, args) => {
    if (command === "set_menu_bar") sent.push(args);

    if (command.startsWith("plugin:window|")) windowCalls.push(command);

    return null;
  }, { shouldMockEvents: true });
  const app = createTauriApp();

  const menu: MenuBar = { mark: "waiting", dock: [], entries: [
    { label: "Waiting", action: null },
    { label: "Ada", action: { kind: "agent", path: "/original", agent: "a" } },
    { label: "Open roundup", action: { kind: "open" } },
  ] };

  const stop = app.onMenuBarAction(action => heard.push(action));
  await new Promise(resolve => setTimeout(resolve, 0));

  await app.setMenuBar(menu);
  await emit("menu-bar-action", { kind: "agent", path: "/original", agent: "a" });
  expect(windowCalls).toEqual([]);
  await app.showWindow();
  expect(windowCalls).toEqual(["plugin:window|unminimize", "plugin:window|show", "plugin:window|set_focus"]);
  stop();
  await new Promise(resolve => setTimeout(resolve, 0));
  await emit("menu-bar-action", { kind: "open" });

  expect(sent).toEqual([{ menu }]);
  expect(heard).toEqual([{ kind: "agent", path: "/original", agent: "a" }]);
});

it("u5503_native_refresh_failure_reaches_the_app_without_window_effects", async () => {
  const heard: MenuBarAction[] = [];
  const windowCalls: string[] = [];
  mockWindows("main");
  mockIPC(command => {
    if (command.startsWith("plugin:window|")) windowCalls.push(command);

    return null;
  }, { shouldMockEvents: true });
  const app = createTauriApp();
  const stop = app.onMenuBarAction(action => heard.push(action));
  await new Promise(resolve => setTimeout(resolve, 0));
  await emit("menu-bar-action", { kind: "failure", message: "Native section unavailable" });
  stop();
  expect(heard).toEqual([{ kind: "failure", message: "Native section unavailable" }]);
  expect(windowCalls).toEqual([]);
});
