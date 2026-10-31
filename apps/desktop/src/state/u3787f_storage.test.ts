import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { storageCopy } from "./copy";
import * as v from "valibot";
import { initializeStorage, storedValue, draftStorage, storageProblems, useBrowserStorage } from "./storage";
// The production composition tree registers each existing family parser.
import "../App";

// Exercise the official JS plugin through its IPC seam; real native durability/reopen
// is asserted by s2297a's store_durability observers, not by this IPC adapter.
const disk = new Map<string, unknown>();

const cache = new Map<string, unknown>();

const save = vi.fn(async () => { for (const [key, value] of cache) disk.set(key, structuredClone(value)); });

const native = { disk, cache, save };

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke: async (command: string, args: { key: string; value: unknown }) => {
    if (command === "plugin:resources|close") return;

    if (command === "plugin:store|load") {
      cache.clear();

      for (const [key, value] of disk) cache.set(key, structuredClone(value));

      return 1;
    }

    if (command === "plugin:store|entries") return [...cache];

    if (command === "plugin:store|set") { cache.set(args.key, structuredClone(args.value));

 return; }

    if (command === "plugin:store|save") return save();
    throw new Error(`Unexpected native command: ${command}`);
  } });
});

afterEach(() => { localStorage.clear(); disk.clear(); cache.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useBrowserStorage(window.localStorage); });

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

it("u3787f_interrupted_migration_preserves_both_stores", async () => {
  const key = "roundup:open-tab";
  localStorage.setItem(key, '"/legacy/original"');
  const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementationOnce(() => { throw new Error("cleanup interrupted"); });
  expect(await initializeStorage()).toContain("cleanup interrupted");
  expect(disk.get(key)).toEqual({ version: 1, value: "/legacy/original" });
  expect(localStorage.getItem(key)).toBe('"/legacy/original"');
  // Another completed save after the interruption must win over the old legacy source.
  disk.set(key, { version: 1, value: "/plugin/newer" });
  remove.mockRestore();
  expect(await initializeStorage()).toBeNull();
  expect(storedValue(key, v.string()).read()).toBe("/plugin/newer");
  expect(localStorage.getItem(key)).toBeNull();
  // An interrupted cleanup followed by a user clear must not revive the old value.
  localStorage.setItem(key, '"/legacy/original"');
  expect(await storedValue(key, v.string()).clear()).toBeNull();
  expect(await initializeStorage()).toBeNull();
  expect(storedValue(key, v.string()).restore()).toEqual({ status: "missing" });
});

it("u3787f_failed_migration_keeps_recovery", async () => {
  const key = "roundup:open-tab";
  localStorage.setItem(key, '"/original/雪"');
  disk.set("roundup:rail:/other", { version: 1, value: { selected: "newer", collapsed: ["home-original"] } });
  save.mockRejectedValueOnce(new Error("write work.json: disk quota exceeded; original committed file preserved"));
  expect(await initializeStorage()).toContain("disk quota exceeded");
  expect(localStorage.getItem(key)).toBe('"/original/雪"');
  expect(disk.has(key)).toBe(false);
  expect(disk.get("roundup:rail:/other")).toEqual({ version: 1, value: { selected: "newer", collapsed: ["home-original"] } });
  disk.set(key, { version: 1, value: "/newer/committed" });
  expect(await initializeStorage()).toBeNull();
  expect(storedValue(key, v.string()).read()).toBe("/newer/committed");
});

it.each(["{broken", "42"])("u3787f_failed_migration_keeps_recovery_invalid_%s", async bytes => {
  localStorage.setItem("roundup:open-tab", bytes);
  const before = [...disk];
  expect(await initializeStorage()).toMatch(/Could not restore/);
  expect(localStorage.getItem("roundup:open-tab")).toBe(bytes);
  expect([...disk]).toEqual(before);
});

it("u3787f_store_acknowledgement_waits_for_commit_and_retry_keeps_newer_memory", async () => {
  expect(await initializeStorage()).toBeNull();
  let release = () => {};

  let started = () => {};

  const saving = new Promise<void>(resolve => { started = resolve; });
  save.mockImplementationOnce(async () => { started(); await new Promise<void>(resolve => { release = resolve; }); throw new Error("read back work.json: permission denied"); });
  const drafts = draftStorage("/original");
  const destination = { surface: "ask", object: "original-question", recipient: "original-agent" };
  const older = drafts.edit(destination, { text: " old 雪 " }, null, "ordinary");
  let acknowledged = false;
  void older.retained.then(() => { acknowledged = true; });
  await saving;
  expect(acknowledged).toBe(false);
  const newer = drafts.edit(destination, { text: " newer e\u0301 😀\n " }, null, "ordinary");
  expect(drafts.list()).toEqual([newer.draft]);
  release();
  expect(await older.retained).toMatchObject({ operation: "retain", cause: "write" });
  expect(await newer.retained).toBeNull();
  expect(await drafts.retry()).toBeNull();
  expect(draftStorage("/original").list()).toEqual([newer.draft]);
  expect(storageProblems()).toEqual([]);
  expect(localStorage.length).toBe(0);
});

it("u3787f_failed_migration_keeps_recovery_retry_never_rebases_an_older_write", async () => {
  const key = "roundup:open-tab";
  disk.set(key, { version: 1, value: "/committed/base" });
  expect(await initializeStorage()).toBeNull();
  save.mockRejectedValueOnce(new Error("save reply lost"));
  expect(await storedValue(key, v.string()).write("/older/pending")).toBe("save reply lost");
  disk.set(key, { version: 1, value: "/newer/committed" });

  for (let attempt = 0; attempt < 2; attempt++) {
    expect(await storageProblems()[0]!.retry()).toBe(storageCopy.changed);
    expect(disk.get(key)).toEqual({ version: 1, value: "/newer/committed" });
  }
});

it("u3787f_failed_migration_keeps_recovery_unreadable_legacy", async () => {
  const key = "roundup:open-tab";
  localStorage.setItem(key, '"/original/path"');
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => { throw new Error("read denied by webview"); });
  expect(await initializeStorage()).toContain("read denied by webview");
  expect(disk.size).toBe(0);
  read.mockRestore();
  expect(localStorage.getItem(key)).toBe('"/original/path"');
  expect(await initializeStorage()).toBeNull();
  expect(storedValue(key, v.string()).read()).toBe("/original/path");
});
