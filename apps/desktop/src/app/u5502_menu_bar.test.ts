import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, expect, it } from "vitest";
import { createTauriApp } from "./tauri";
import type { MenuBarAction, MenuBar } from "./seam";

afterEach(clearMocks);

it("u5502_the_app_seam_keeps_original_menu_identities", async () => {
  const sent: unknown[] = [];
  const heard: MenuBarAction[] = [];
  mockIPC((command, args) => {
    if (command === "set_menu_bar") sent.push(args);

    return null;
  }, { shouldMockEvents: true });
  const app = createTauriApp();

  const menu: MenuBar = { mark: "waiting", entries: [
    { label: "Waiting", action: null },
    { label: "Ada", action: { kind: "agent", path: "/original", agent: "a" } },
    { label: "Open roundup", action: { kind: "open" } },
  ] };

  const stop = await app.onMenuBarAction(action => heard.push(action));

  await app.setMenuBar(menu);
  await emit("menu-bar-action", { kind: "agent", path: "/original", agent: "a" });
  stop();
  await emit("menu-bar-action", { kind: "open" });

  expect(sent).toEqual([{ menu }]);
  expect(heard).toEqual([{ kind: "agent", path: "/original", agent: "a" }]);
});
