import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { afterEach, expect, it } from "vitest";
import { followMaterial } from "./tauri";

afterEach(() => { clearMocks(); document.documentElement.removeAttribute("data-native-material"); });

it("u134_native_material_is_revealed_only_after_native_confirmation", async () => {
  mockWindows("main");
  mockIPC(() => true, { shouldMockEvents: true });
  const stop = await followMaterial(document.documentElement);
  expect(document.documentElement.hasAttribute("data-native-material")).toBe(true);
  stop();
  expect(document.documentElement.hasAttribute("data-native-material")).toBe(false);
});

it("u135_native_reduced_transparency_restores_opaque_grounds", async () => {
  mockWindows("main");
  mockIPC(() => true, { shouldMockEvents: true });
  const stop = await followMaterial(document.documentElement);
  await emit("native-material", false);
  expect(document.documentElement.hasAttribute("data-native-material")).toBe(false);
  await emit("native-material", true);
  expect(document.documentElement.hasAttribute("data-native-material")).toBe(true);
  stop();
});

it("u134_unsupported_material_keeps_opaque_grounds", async () => {
  mockWindows("main");
  mockIPC(() => false, { shouldMockEvents: true });
  const stop = await followMaterial(document.documentElement);
  expect(document.documentElement.hasAttribute("data-native-material")).toBe(false);
  stop();
});
