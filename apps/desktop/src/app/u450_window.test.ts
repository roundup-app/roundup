import { emit } from "@tauri-apps/api/event";
import type { SystemAccent } from "./seam";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, expect, it, vi } from "vitest";
import { createTauriApp } from "./tauri";
import { RpcError } from "./seam";

afterEach(() => { clearMocks(); vi.restoreAllMocks(); });

it("u450_native_setter_receives_the_full_text", async () => {
  mockWindows("main", "other");
  const received: unknown[] = [];
  mockIPC((command, args) => { received.push({ command, args }); });
  const title = `Project — ${"長".repeat(300)}`;
  await createTauriApp().forProject("/p").setWindowTitle(title);
  expect(received).toEqual([{ command: "plugin:window-bar|set_window_title", args: { title } }]);
});

it.each([
  ["dragWindow", "drag_window"],
  ["zoomWindow", "zoom_window"],
] as const)("u451_%s_invokes_only_the_current_window", async (method, operation) => {
  mockWindows("main", "other");
  const received: unknown[] = [];
  mockIPC((command, args) => { received.push({ command, args }); });
  await createTauriApp()[method]();
  expect(received).toEqual([{ command: `plugin:window-bar|${operation}`, args: {} }]);
});

it.each(["setWindowTitle", "dragWindow", "zoomWindow"] as const)("u450_%s_reports_native_rejection", async (method) => {
  mockWindows("main");
  mockIPC(() => { throw "native window refused"; });
  const failure = createTauriApp()[method]("roundup");
  await expect(failure).rejects.toBeInstanceOf(RpcError);
  await expect(failure).rejects.toMatchObject({ code: -32603, message: "native window refused" });
});

it("u130_native_accent_delivers_the_initial_preference_changes_and_fallback", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const initial: SystemAccent = [0.2, 0.4, 0.8];
  const changed: SystemAccent = [0.7, 0.3, 0.2];
  const received: SystemAccent[] = [];
  mockIPC(command => command === "system_accent" ? initial : null, { shouldMockEvents: true });
  const stop = await createTauriApp().onSystemAccent(accent => received.push(accent));
  await emit("system-accent", changed);
  await emit("system-accent", null);
  expect(received).toEqual([initial, changed, null]);
  stop();
  await emit("system-accent", initial);
  expect(received).toHaveLength(3);
});
