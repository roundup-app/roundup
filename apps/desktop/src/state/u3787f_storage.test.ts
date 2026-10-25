import { afterEach, expect, it, vi } from "vitest";
import * as v from "valibot";
import { initializeStorage, storedValue } from "./storage";
// Import the production composition tree: each family registers its existing parser.
import "../App";

const native = vi.hoisted(() => {
  const disk = new Map<string, unknown>();
  const cache = new Map<string, unknown>();
  return { disk, cache, save: vi.fn(async () => { for (const [key, value] of cache) disk.set(key, structuredClone(value)); }) };
});

vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({
  entries: async () => [...native.cache],
  set: async (key: string, value: unknown) => { native.cache.set(key, structuredClone(value)); },
  save: native.save,
}) }));

afterEach(() => { localStorage.clear(); native.disk.clear(); native.cache.clear(); vi.clearAllMocks(); });

it("u3787f_store_migrates_all_key_families", async () => {
  const draft = { revision: "original-revision", destination: { surface: "ask", object: "question-original", recipient: "agent-original" }, value: { text: " e\u0301\n雪 😀 " }, selection: { start: 1, end: 3, direction: "backward" }, status: "pending", policy: "ordinary" };
  const families = new Map<string, unknown>([
    ["roundup:open-tab", "/original/雪"],
    ["roundup:unseen:/original/雪", { "agent-original": "12345678901234567890" }],
    ["roundup:drafts:/original/雪", { version: 1, drafts: [draft] }],
    ["roundup:import:/original/雪", { open: true, period: "week", selected: [{ source: "original-source", revision: "original-version", title: " 雪 " }] }],
    ["roundup:rail:/original/雪", { selected: "agent-original", collapsed: ["home-original"] }],
    ["roundup:app-settings", { fontFamily: "Original font", mode: "dark" }],
    ["roundup:widths:/original/雪", { rail: 301, shelf: 411 }],
    ["roundup:shelf:/original/雪", { open: false, maximised: true, tab: "pads" }],
    ["roundup:terminal-font:/original/雪", 17],
  ]);
  for (const [key, value] of families) localStorage.setItem(key, JSON.stringify(value));
  expect(await initializeStorage()).toBeNull();
  for (const [key, value] of families) {
    expect(native.disk.get(key)).toEqual({ version: 1, value });
    expect(storedValue(key, v.unknown()).read()).toEqual(value);
    expect(localStorage.getItem(key)).toBeNull();
  }
});
