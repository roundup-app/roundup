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
    if (command === "plugin:window-bar|webview_data_path") return "/isolated/WebKit/roundup/WebsiteData";

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

it("n5467b_old_browser_storage_is_refused", async () => {
  localStorage.setItem("roundup:unknown-retired-family", "{invalid sentinel");
  const read = vi.spyOn(Storage.prototype, "getItem");
  const remove = vi.spyOn(Storage.prototype, "removeItem");
  const write = vi.spyOn(Storage.prototype, "setItem");
  const before = [...disk];

  for (let attempt = 0; attempt < 2; attempt++) {
    const failure = await initializeStorage();
    expect(failure?.message).toContain("incompatible");
    expect(failure?.message).toContain("/isolated/WebKit/roundup/WebsiteData");
    expect(failure?.message).toContain("Close roundup");
    expect(storedValue("roundup:open-tab", v.string()).restore()).toEqual({ status: "failed", cause: "unreadable" });
  }

  expect(read).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(cache.size).toBe(0);
  expect([...disk]).toEqual(before);
  // Simulate the user's manual removal, then the unchanged fresh/current path.
  localStorage.clear();
  expect(await initializeStorage()).toBeNull();
  const value = storedValue("roundup:open-tab", v.string());
  expect(await value.write("/current/雪")).toBeNull();
  expect(await initializeStorage()).toBeNull();
  expect(value.read()).toBe("/current/雪");
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

it("u3787f_retry_never_rebases_an_older_write", async () => {
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


it("n5467c_current_native_records_reopen_with_exact_identity", async () => {
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

  for (const [key, value] of families) disk.set(key, { version: 1, value });
  expect(await initializeStorage()).toBeNull();
  expect(await initializeStorage()).toBeNull();

  for (const [key, value] of families) {
    expect(native.disk.get(key)).toEqual({ version: 1, value });
    expect(storedValue(key, v.unknown()).read()).toEqual(value);
    expect(localStorage.getItem(key)).toBeNull();
  }
});
