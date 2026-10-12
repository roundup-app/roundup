import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "./seam";
import { createTauriApp } from "./tauri";

afterEach(clearMocks);

it("u418_the_tauri_adapter_sends_the_bytes_to_save_pasted_image", async () => {
  const seen: { command: string; args: unknown }[] = [];

  mockIPC((command, args) => {
    seen.push({ command, args });

    return "/Users/me/Library/Caches/roundup-pasted/pasted-1-abcd1234.png";
  }, { shouldMockEvents: false });

  const bytes = Uint8Array.of(1, 2, 3);
  const path = await createTauriApp().savePastedImage({ type: "image/png", bytes });

  expect(path).toBe("/Users/me/Library/Caches/roundup-pasted/pasted-1-abcd1234.png");
  expect(seen).toHaveLength(1);
  expect(seen[0]!.command).toBe("save_pasted_image");
  expect(seen[0]!.args).toEqual(bytes);
});

it("u418_a_refused_save_rejects_with_the_apps_code_and_message", async () => {
  mockIPC(() => {
    throw { code: -32002, message: "too big" };
  });

  await expect(createTauriApp().savePastedImage({ type: "image/png", bytes: new Uint8Array() })).rejects.toMatchObject({
    code: -32002,
    message: "too big",
  });
  await expect(createTauriApp().savePastedImage({ type: "image/png", bytes: new Uint8Array() })).rejects.toBeInstanceOf(RpcError);
});
