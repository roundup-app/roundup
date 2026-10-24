import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, expect, it } from "vitest";
import { writeText } from "./clipboard";
import { createTauriApp } from "./tauri";

afterEach(clearMocks);

it("u3560c_copy_uses_the_native_pasteboard_once", async () => {
  const calls: unknown[] = [];
  mockIPC((command, args) => { calls.push({ command, args }); });
  await writeText(createTauriApp(), "exact e\u0301\n雪 🐈");
  expect(calls).toEqual([{ command: "plugin:clipboard-manager|write_text", args: { text: "exact e\u0301\n雪 🐈" } }]);
});

it("u3560d_native_copy_preserves_the_platform_cause", async () => {
  mockIPC(() => { throw "Pasteboard unavailable"; });
  await expect(writeText(createTauriApp(), "unsent")).rejects.toThrow("Pasteboard unavailable");
});
