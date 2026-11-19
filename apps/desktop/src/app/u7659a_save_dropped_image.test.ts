import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, expect, it } from "vitest";
import { createTauriApp } from "./tauri";

afterEach(clearMocks);

it("u7659a_the_tauri_adapter_sends_the_path_to_save_dropped_image", async () => {
  const seen: { command: string; args: unknown }[] = [];

  mockIPC((command, args) => {
    seen.push({ command, args });

    return "/Users/me/Library/Caches/roundup-pasted/pasted-1-abcd1234.png";
  }, { shouldMockEvents: false });

  const path = await createTauriApp().saveDroppedImage("/var/T/Shot.png");

  expect(path).toBe("/Users/me/Library/Caches/roundup-pasted/pasted-1-abcd1234.png");
  expect(seen).toEqual([{ command: "save_dropped_image", args: { path: "/var/T/Shot.png" } }]);
});
