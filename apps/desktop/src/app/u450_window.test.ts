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

