import * as v from "valibot";
import { afterEach, expect, it, vi } from "vitest";
import { draftStorage, storedValue } from "./storage";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it("u2773e_storage_failure_keeps_memory_distinguishes_missing_from_invalid", () => {
  const storage = storedValue("draft", v.string());
  expect(storage.restore()).toEqual({ status: "missing" });
  localStorage.setItem("draft", "{broken");
  expect(storage.restore()).toEqual({ status: "failed", cause: "invalid" });
  expect(localStorage.getItem("draft")).toBe("{broken");
  expect(storage.read()).toBeNull();
});

it("u2773a_storage_restores_exact_work", () => {
  const drafts = draftStorage("/project/a");
  const value = { text: " \ne\u0301 😀\n ", choices: ["second", "first"], enabled: false };
  const revision = drafts.edit({ surface: "decisions", object: "d1", recipient: "agent-a" }, value, { start: 2, end: 5, direction: "backward" }, "ordinary").draft;
  const reopened = draftStorage("/project/a");
  expect(reopened.list()).toEqual([{ ...revision, value, status: "draft" }]);
  expect(draftStorage("/project/b").list()).toEqual([]);
  expect(reopened.problem()).toBeNull();
});

const target = { surface: "ask", object: "ask-bar", recipient: "agent-a" };

const edit = (drafts: ReturnType<typeof draftStorage>, text: string) => drafts.edit(target, { text }, null, "ordinary").draft;

it.each(["acknowledged", "failed", "unknown"] as const)("u2773b_storage_settlement_preserves_other_revisions_%s", (outcome) => {
  const drafts = draftStorage("/project/a");
  const a = edit(drafts, " A\n😀 ");
  expect(drafts.submit(a.revision)?.draft.value).toEqual({ text: " A\n😀 " });
  const b = edit(drafts, " B\ne\u0301 ");
  drafts.settle(a.revision, outcome);
  expect(draftStorage("/project/a").list()).toEqual(outcome === "acknowledged"
    ? [b] : [{ ...a, status: outcome }, b]);
});

it("u2773b_storage_discard_consumes_only_selected_revision", () => {
  const drafts = draftStorage("/project/a");
  const a = edit(drafts, "old");
  drafts.submit(a.revision);
  const b = edit(drafts, "new");
  drafts.discard(a.revision);
  drafts.settle(a.revision, "failed");
  expect(draftStorage("/project/a").list()).toEqual([b]);
});

it("u2773b_storage_pending_reopens_as_unknown_without_resubmission", () => {
  const drafts = draftStorage("/project/a");
  const a = edit(drafts, "maybe accepted");
  drafts.submit(a.revision);
  const reopened = draftStorage("/project/a");
  expect(reopened.list()).toEqual([{ ...a, status: "unknown" }]);
  expect(reopened.submit(a.revision)).toBeNull();
});

it("u2773e_storage_failure_keeps_memory", () => {
  const drafts = draftStorage("/project/a");
  const a = edit(drafts, "stored");
  drafts.submit(a.revision);
  const before = localStorage.getItem("roundup:drafts:/project/a");
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  const result = drafts.edit(target, { text: " complete\nnew 😀 " }, null, "ordinary");
  const b = result.draft;
  expect(result.problem).toEqual({ project: "/project/a", destination: target, revision: b.revision, operation: "retain", cause: "write" });
  expect(drafts.list()).toEqual([{ ...a, status: "pending" }, { ...b, value: { text: " complete\nnew 😀 " } }]);
  expect(localStorage.getItem("roundup:drafts:/project/a")).toBe(before);
  write.mockRestore();
  expect(drafts.retry()).toBeNull();
  expect(draftStorage("/project/a").list()).toEqual([{ ...a, status: "unknown" }, b]);
});

it.each(["{broken", '{"version":2,"drafts":[]}', '{"version":1,"drafts":[{}]}'])("u2773e_storage_failure_keeps_invalid_records_%s", (raw) => {
  localStorage.setItem("roundup:drafts:/project/a", raw);
  const drafts = draftStorage("/project/a");
  const b = edit(drafts, "newer");
  expect(drafts.problem()).toEqual({ project: "/project/a", destination: target, revision: b.revision, operation: "restore", cause: "invalid" });
  expect(drafts.list()).toEqual([b]);
  expect(drafts.retry()?.cause).toBe("invalid");
  expect(localStorage.getItem("roundup:drafts:/project/a")).toBe(raw);
});

it("u2773e_storage_failure_keeps_memory_on_unreadable_restore", () => {
  const first = draftStorage("/project/a");
  const a = edit(first, "stored older");
  first.submit(a.revision);
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("unavailable"); });
  const drafts = draftStorage("/project/a");
  expect(drafts.problem()?.cause).toBe("unreadable");
  const b = edit(drafts, "in memory");
  read.mockRestore();
  expect(drafts.retry()).toBeNull();
  expect(draftStorage("/project/a").list()).toEqual([{ ...a, status: "unknown" }, b]);
});

it("u2773e_storage_failure_keeps_memory_at_utf8_bound", () => {
  const disk = new Map<string, string>();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => disk.get(key) ?? null);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => { disk.set(key, value); });
  const drafts = draftStorage("/project/a");
  edit(drafts, "");
  const overhead = new TextEncoder().encode(disk.get("roundup:drafts:/project/a")!).length;
  const exact = "😀" + "x".repeat(10 * 1024 * 1024 - overhead - 4);
  const a = edit(drafts, exact);
  expect(drafts.problem()).toBeNull();
  expect(new TextEncoder().encode(disk.get("roundup:drafts:/project/a")!).length).toBe(10 * 1024 * 1024);
  const before = disk.get("roundup:drafts:/project/a");
  const b = edit(drafts, exact + "x");
  expect(drafts.problem()?.cause).toBe("capacity");
  expect(drafts.list()).toEqual([b]);
  expect(drafts.list()[0]?.value.text).toBe(exact + "x");
  expect(disk.get("roundup:drafts:/project/a")).toBe(before);
  expect(draftStorage("/project/a").list()).toEqual([a]);
  expect(drafts.discard(b.revision)).toBeNull();
  expect(draftStorage("/project/a").list()).toEqual([]);
});

it("u2773e_credentials_keep_existing_policy", () => {
  const log = vi.spyOn(console, "log");
  const error = vi.spyOn(console, "error");
  const drafts = draftStorage("/project/a");
  const secret = drafts.edit({ ...target, surface: "credential" }, { text: "sentinel-secret-2783" }, null, "credential").draft;
  drafts.submit(secret.revision);
  drafts.settle(secret.revision, "failed");
  expect(drafts.list()).toEqual([{ ...secret, status: "failed" }]);
  expect(draftStorage("/project/a").list()).toEqual([]);

  for (const sink of [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.documentElement.outerHTML, JSON.stringify(log.mock.calls), JSON.stringify(error.mock.calls)]) {
    expect(sink).not.toContain("sentinel-secret-2783");
  }
});

it("u2773a_storage_identity_separates_surface_object_recipient", () => {
  const drafts = draftStorage("/project/a");
  const destinations = [target, { ...target, surface: "orders" }, { ...target, object: "another" }, { ...target, recipient: "agent-b" }];
  const expected = destinations.map((destination, index) => drafts.edit(destination, { text: `exact ${index}` }, null, "ordinary").draft);
  const reopened = draftStorage("/project/a").list();
  expect(reopened).toEqual(expected);
  expect(reopened.map((draft) => draft.destination)).toEqual(destinations);
});

it("u2773e_storage_retry_merges_external_records_without_reviving_discard", () => {
  const drafts = draftStorage("/project/a");
  const a = edit(drafts, "selected discard");
  const other = draftStorage("/project/a");
  const external = other.edit({ ...target, object: "other" }, { text: "external" }, null, "ordinary").draft;
  expect(drafts.discard(a.revision)?.cause).toBe("changed");
  expect(drafts.retry()).toBeNull();
  expect(draftStorage("/project/a").list()).toEqual([external]);
});

it("u2773b_storage_failed_retry_requires_explicit_submit", () => {
  const drafts = draftStorage("/project/a");
  const a = edit(drafts, "failed work");
  drafts.submit(a.revision);
  drafts.settle(a.revision, "failed");
  const reopened = draftStorage("/project/a");
  expect(reopened.submit(a.revision)).toEqual({ draft: { ...a, status: "pending" }, problem: null });
  expect(reopened.submit(a.revision)).toBeNull();
});

it("u2773a_storage_restoration_writes_nothing", () => {
  const first = draftStorage("/project/a");
  const a = edit(first, "not authorized to save or send");
  const write = vi.spyOn(Storage.prototype, "setItem");
  const reopened = draftStorage("/project/a");
  const copy = reopened.list();
  copy[0]!.value.text = "caller mutation";
  expect(reopened.list()).toEqual([a]);
  expect(write).not.toHaveBeenCalled();
});

it.each(["pending", "failed"] as const)("u2773e_storage_bound_counts_%s_revisions_across_surfaces", (status) => {
  const disk = new Map<string, string>();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => disk.get(key) ?? null);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => { disk.set(key, value); });
  const drafts = draftStorage("/project/a");
  const a = edit(drafts, "a".repeat(6 * 1024 * 1024));
  drafts.submit(a.revision);

  if (status === "failed") drafts.settle(a.revision, "failed");
  const before = disk.get("roundup:drafts:/project/a");
  const b = drafts.edit({ ...target, surface: "changes" }, { text: "b".repeat(5 * 1024 * 1024) }, null, "ordinary").draft;
  expect(drafts.problem()?.cause).toBe("capacity");
  expect(disk.get("roundup:drafts:/project/a")).toBe(before);
  expect(drafts.list()).toEqual([{ ...a, status }, b]);
  expect(drafts.discard(a.revision)).toBeNull();
  expect(draftStorage("/project/a").list()).toEqual([b]);
});

it("u2773b_storage_late_out_of_order_replies_keep_original_project", () => {
  const first = draftStorage("/project/a");
  const a = edit(first, "first submit");
  first.submit(a.revision);
  const b = edit(first, "second submit");
  first.submit(b.revision);
  const current = edit(first, "newest");
  const second = draftStorage("/project/b");
  const elsewhere = edit(second, "same named agent in another Project");
  first.settle(b.revision, "acknowledged");
  first.settle(a.revision, "failed");
  expect(draftStorage("/project/a").list()).toEqual([{ ...a, status: "failed" }, current]);
  expect(draftStorage("/project/b").list()).toEqual([elsewhere]);
});
