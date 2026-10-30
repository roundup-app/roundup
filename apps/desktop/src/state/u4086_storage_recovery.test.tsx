import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@solidjs/testing-library";
import * as v from "valibot";
import { initializeStorage, storageRecovery, retainedStorage, storedValue, draftStorage, useBrowserStorage } from "./storage";
import { StorageRecovery } from "../app/StorageRecovery";
import { storageCopy } from "../app/copy";
import "../App";

// Official plugin JS API, with only native IPC controlled. A load recreates its cache
// from committed data; native fsync/readback remains covered by store_durability.
const disk = new Map<string, unknown>();

const cache = new Map<string, unknown>();

const save = vi.fn(async () => {
  for (const [key, value] of cache) {
    // Native JSON object ordering need not match the renderer's insertion order.
    const record = v.safeParse(v.strictObject({ version: v.literal(1), value: v.unknown() }), value);
    disk.set(key, record.success ? { value: structuredClone(record.output.value), version: 1 } : structuredClone(value));
  }
});

const entries = vi.fn(async () => [...cache]);

beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke: async (command: string, args: { key: string; value: unknown }) => {
    if (command === "plugin:resources|close") return;

    if (command === "plugin:store|load") {
      cache.clear();

      for (const [key, value] of disk) cache.set(key, structuredClone(value));

      return 1;
    }

    if (command === "plugin:store|entries") return entries();

    if (command === "plugin:store|set") { cache.set(args.key, structuredClone(args.value));

 return; }

    if (command === "plugin:store|save") return save();
    throw new Error(`Unexpected native command: ${command}`);
  } });
});

afterEach(() => { cleanup(); localStorage.clear(); disk.clear(); cache.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useBrowserStorage(localStorage); });

const keys = ["open-tab", "unseen:/p", "drafts:/p", "import:/p", "rail:/p", "app-settings", "widths:/p", "shelf:/p", "terminal-font:/p"];

const values: unknown[] = ["/newer", { original: "123" }, { version: 1, drafts: [] }, { open: true, period: "week", selected: [] }, { selected: "newer", collapsed: [] }, { mode: "dark" }, { rail: 301 }, { open: true, maximised: false, tab: "pads" }, 17];

it.each(keys.flatMap(key => ["{\"open\":", key === "app-settings" || key.startsWith("widths:") ? "null" : '{"open":"yes"}'].map(bytes => ({ key: `roundup:${key}`, bytes }))))("u4086a_invalid_legacy_record_has_retry_and_continue $key $bytes", async ({ key, bytes }) => {
  localStorage.setItem(key, bytes);
  render(() => <StorageRecovery><input aria-label="Saved work editor" /></StorageRecovery>);
  await screen.findByRole("button", { name: storageCopy.continue(key) });
  expect(screen.getByRole("alert")).toBeDefined();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(storageRecovery()?.key).toBe(key);
  expect(localStorage.getItem(key)).toBe(bytes);
  expect(disk.size).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: storageCopy.restoreRetry }));
  await screen.findByRole("button", { name: storageCopy.continue(key) });
  expect(localStorage.getItem(key)).toBe(bytes);
  // Repair is read anew rather than pinned to an old failure.
  const repaired = values[keys.indexOf(key.slice("roundup:".length))];
  localStorage.setItem(key, JSON.stringify(repaired));
  fireEvent.click(screen.getByRole("button", { name: storageCopy.restoreRetry }));
  await screen.findByRole("textbox", { name: "Saved work editor" });
  expect(storedValue(key, v.unknown()).read()).toEqual(repaired);
});

it.each(keys.flatMap(key => ["{\"open\":", key === "app-settings" || key.startsWith("widths:") ? "null" : '{"open":"yes"}'].map(bytes => ({ key: `roundup:${key}`, bytes }))))("u4086b_continue_quarantines_one_record_and_reopens $key $bytes", async ({ key, bytes }) => {
  localStorage.setItem(key, bytes);
  localStorage.setItem("roundup:rail:/other", '{"selected":"original-agent","collapsed":["original-home"]}');
  const draft = { revision: "original-revision", destination: { surface: "ask", object: "original-object", recipient: "original-agent" }, value: { text: " e\u0301\n雪 😀 " }, selection: null, status: "pending", policy: "ordinary" };
  localStorage.setItem("roundup:drafts:/other", JSON.stringify({ version: 1, drafts: [draft] }));
  const newer = bytes === '{"open":' ? undefined : values[keys.indexOf(key.slice("roundup:".length))];

  if (newer !== undefined) disk.set(key, { version: 1, value: newer });
  expect(await initializeStorage()).not.toBeNull();
  expect(await storageRecovery()!.continue()).toBeNull();
  expect(localStorage.getItem(key)).toBeNull();
  expect(retainedStorage()).toEqual([{ key, bytes }]);
  expect(storedValue(key, v.unknown()).restore()).toEqual(newer === undefined ? { status: "missing" } : { status: "restored", value: newer });
  expect(draftStorage("/other").list()).toEqual([{ ...draft, status: "unknown" }]);
  expect(storedValue("roundup:rail:/other", v.unknown()).read()).toEqual({ selected: "original-agent", collapsed: ["original-home"] });
  expect(await initializeStorage()).toBeNull();
  expect(retainedStorage()).toEqual([{ key, bytes }]);
});

it.each(["save", "read", "mismatch", "restart-read", "cleanup"])("u4086c_quarantine_failure_and_interruption_preserve_recovery %s", async failure => {
  const key = "roundup:shelf:/p";
  const bytes = '{"open":';
  localStorage.setItem(key, bytes);
  await initializeStorage();

  if (failure === "save") save.mockRejectedValueOnce(new Error("disk full"));

  if (failure === "read") entries.mockImplementationOnce(async () => [...cache]).mockRejectedValueOnce(new Error("read denied"));

  if (failure === "mismatch") entries.mockImplementationOnce(async () => [...cache]).mockImplementationOnce(async () =>
    [...cache].map(([name]): [string, unknown] => [name, { key, bytes: "different retained bytes" }]));

  if (failure === "restart-read") entries.mockImplementationOnce(async () => [...cache])
    .mockImplementationOnce(async () => [...cache]).mockRejectedValueOnce(new Error("reopen denied"));
  const remove = vi.spyOn(Storage.prototype, "removeItem");

  if (failure === "cleanup") remove.mockImplementationOnce(() => { throw new Error("interrupted cleanup"); });
  const recovery = storageRecovery()!;
  const operation = recovery.continue();
  expect(recovery.continue()).toBe(operation);
  expect(await operation).not.toBeNull();
  expect(localStorage.getItem(key)).toBe(bytes);
  expect(storedValue(key, v.unknown()).restore().status).toBe("failed");
  expect(storageRecovery()).not.toBeNull();
  remove.mockRestore();
  await initializeStorage();

  if (storageRecovery()) expect(await storageRecovery()!.continue()).toBeNull();
  expect(localStorage.getItem(key)).toBeNull();
  expect(retainedStorage()).toEqual([{ key, bytes }]);
});

it("u4086d_recovery_is_per_record_and_never_clears_other_work", async () => {
  const original = new Map([["roundup:shelf:/p", '{"open":'], ["roundup:rail:/q", '{"selected":'], ["unrelated", "private bytes"], ["roundup:terminal-font:/q", "17"]]);

  original.set("roundup:terminal-font:/p", "19");

  for (const project of ["/p", "/q"]) {
    original.set(`roundup:drafts:${project}`, JSON.stringify({ version: 1, drafts: [{
      revision: `revision-${project}`, destination: { surface: "ask", object: `object-${project}`, recipient: `agent-${project}` },
      value: { text: `exact draft ${project} 雪` }, selection: null, status: "draft", policy: "ordinary",
    }] }));
  }

  for (const [key, bytes] of original) localStorage.setItem(key, bytes);
  await initializeStorage();
  expect(await storageRecovery()!.continue()).not.toBeNull();
  expect(retainedStorage()).toEqual([{ key: "roundup:shelf:/p", bytes: '{"open":' }]);
  expect(storageRecovery()?.key).toBe("roundup:rail:/q");
  expect(localStorage.getItem("roundup:rail:/q")).toBe('{"selected":');
  expect(new Map(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))).toEqual(original);
  expect(await storageRecovery()!.continue()).toBeNull();
  expect(await initializeStorage()).toBeNull();
  expect(retainedStorage()).toHaveLength(2);
  expect(Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))).toEqual({ unrelated: "private bytes" });
  expect(storedValue("roundup:terminal-font:/q", v.number()).read()).toBe(17);
  expect(storedValue("roundup:terminal-font:/p", v.number()).read()).toBe(19);

  for (const project of ["/p", "/q"]) {
    expect(draftStorage(project).list()).toEqual(JSON.parse(original.get(`roundup:drafts:${project}`)!).drafts);
  }

  localStorage.setItem("roundup:shelf:/unreadable", '{"open":');

  for (const operation of ["key", "getItem"] as const) {
    const read = vi.spyOn(Storage.prototype, operation).mockImplementationOnce(() => { throw new Error("storage read denied"); });
    expect(await initializeStorage()).toContain("storage read denied");
    expect(storageRecovery()).toBeNull();
    read.mockRestore();
    expect(localStorage.getItem("roundup:shelf:/unreadable")).toBe('{"open":');
    expect(retainedStorage()).toHaveLength(2);
  }
});
