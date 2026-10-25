import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@solidjs/testing-library";
import * as v from "valibot";
import { initializeStorage, storageRecovery, retainedStorage, storedValue, useBrowserStorage } from "./storage";
import { StorageRecovery } from "../app/StorageRecovery";
import "../App";

// Official plugin JS API, with only native IPC controlled. A load recreates its cache
// from committed data; native fsync/readback remains covered by store_durability.
const disk = new Map<string, unknown>();
const cache = new Map<string, unknown>();
const save = vi.fn(async () => { for (const [key, value] of cache) disk.set(key, structuredClone(value)); });
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
    if (command === "plugin:store|set") { cache.set(args.key, structuredClone(args.value)); return; }
    if (command === "plugin:store|save") return save();
    throw new Error(`Unexpected native command: ${command}`);
  } });
});
afterEach(() => { cleanup(); localStorage.clear(); disk.clear(); cache.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useBrowserStorage(localStorage); });

const keys = ["open-tab", "unseen:/p", "drafts:/p", "import:/p", "rail:/p", "app-settings", "widths:/p", "shelf:/p", "terminal-font:/p"];

it.each(keys.flatMap(key => ["{\"open\":", '{"open":"yes"}'].map(bytes => ({ key: `roundup:${key}`, bytes }))))("u4086a_invalid_legacy_record_has_retry_and_continue $key $bytes", async ({ key, bytes }) => {
  localStorage.setItem(key, bytes);
  render(() => <StorageRecovery><div>Editor mounted</div></StorageRecovery>);
  await screen.findByRole("button", { name: /Continue without/ });
  expect(screen.getByRole("alert").textContent).toContain("format is invalid");
  expect(screen.queryByText("Editor mounted")).toBeNull();
  expect(storageRecovery()?.key).toBe(key);
  expect(localStorage.getItem(key)).toBe(bytes);
  expect(disk.size).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Retry restoring saved work" }));
  await screen.findByRole("button", { name: /Continue without/ });
  expect(localStorage.getItem(key)).toBe(bytes);
  // Repair is read anew rather than pinned to an old failure.
  localStorage.removeItem(key);
  fireEvent.click(screen.getByRole("button", { name: "Retry restoring saved work" }));
  await screen.findByText("Editor mounted");
});

it.each(keys.flatMap(key => ["{\"open\":", '{"open":"yes"}'].map(bytes => ({ key: `roundup:${key}`, bytes }))))("u4086b_continue_quarantines_one_record_and_reopens $key $bytes", async ({ key, bytes }) => {
  localStorage.setItem(key, bytes);
  localStorage.setItem("roundup:rail:/other", '{"selected":"original-agent","collapsed":["original-home"]}');
  disk.set(key, { version: 1, value: null, removed: true });
  // A valid newer envelope must win; use a tombstone common to every family.
  disk.set(key, { version: 1, removed: true });
  expect(await initializeStorage()).not.toBeNull();
  expect(await storageRecovery()!.continue()).toBeNull();
  expect(localStorage.getItem(key)).toBeNull();
  expect(retainedStorage()).toEqual([{ key, bytes }]);
  expect(storedValue(key, v.unknown()).restore()).toEqual({ status: "missing" });
  expect(storedValue("roundup:rail:/other", v.unknown()).read()).toEqual({ selected: "original-agent", collapsed: ["original-home"] });
  expect(await initializeStorage()).toBeNull();
  expect(retainedStorage()).toEqual([{ key, bytes }]);
});

it.each(["save", "read", "mismatch", "cleanup"])("u4086c_quarantine_failure_and_interruption_preserve_recovery %s", async failure => {
  const key = "roundup:shelf:/p";
  const bytes = '{"open":';
  localStorage.setItem(key, bytes);
  await initializeStorage();
  if (failure === "save") save.mockRejectedValueOnce(new Error("disk full"));
  if (failure === "read") entries.mockImplementationOnce(async () => [...cache]).mockRejectedValueOnce(new Error("read denied"));
  if (failure === "mismatch") entries.mockImplementationOnce(async () => [...cache]).mockResolvedValueOnce([]);
  const remove = vi.spyOn(Storage.prototype, "removeItem");
  if (failure === "cleanup") remove.mockImplementationOnce(() => { throw new Error("interrupted cleanup"); });
  const recovery = storageRecovery()!;
  const operation = recovery.continue();
  expect(recovery.continue()).toBe(operation);
  expect(await operation).not.toBeNull();
  expect(localStorage.getItem(key)).toBe(bytes);
  expect(storedValue(key, v.unknown()).restore().status).toBe("failed");
  remove.mockRestore();
  await initializeStorage();
  if (storageRecovery()) expect(await storageRecovery()!.continue()).toBeNull();
  expect(localStorage.getItem(key)).toBeNull();
  expect(retainedStorage()).toEqual([{ key, bytes }]);
});

it("u4086d_recovery_is_per_record_and_never_clears_other_work", async () => {
  const original = new Map([["roundup:shelf:/p", '{"open":'], ["roundup:rail:/q", '{"selected":'], ["unrelated", "private bytes"], ["roundup:terminal-font:/q", "17"]]);
  for (const [key, bytes] of original) localStorage.setItem(key, bytes);
  await initializeStorage();
  expect(await storageRecovery()!.continue()).not.toBeNull();
  expect(retainedStorage()).toEqual([{ key: "roundup:shelf:/p", bytes: '{"open":' }]);
  expect(storageRecovery()?.key).toBe("roundup:rail:/q");
  expect(localStorage.getItem("roundup:rail:/q")).toBe('{"selected":');
  expect(localStorage.getItem("roundup:terminal-font:/q")).toBe("17");
  expect(await storageRecovery()!.continue()).toBeNull();
  expect(await initializeStorage()).toBeNull();
  expect(retainedStorage()).toHaveLength(2);
  expect(localStorage.getItem("unrelated")).toBe("private bytes");
  expect(storedValue("roundup:terminal-font:/q", v.number()).read()).toBe(17);
  const read = vi.spyOn(Storage.prototype, "key").mockImplementationOnce(() => { throw new Error("enumeration denied"); });
  expect(await initializeStorage()).toContain("enumeration denied");
  expect(storageRecovery()).toBeNull();
  read.mockRestore();
  await waitFor(() => expect(retainedStorage()).toHaveLength(2));
});
