import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createComponent, createComputed, createRoot, useContext } from "solid-js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { createFakeApp } from "../testing/fakeApp";
import { info, terminal } from "../testing/nodes";
import { ConnectedProjectContext, ProjectDraftsContext, useConnectedProject, createProjectDrafts } from "./connectedProject";
import type { ConnectedProject } from "./connectedProject";
import * as v from "valibot";
import { afterEach, expect, it, vi } from "vitest";
import { draftStorage, storedValue } from "./storage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

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

it("u2773e_storage_failure_keeps_memory_for_incompatible_surface", () => {
  const key = "roundup:drafts:/project/a";
  const seed = draftStorage("/project/a");
  const incompatible = seed.edit({ surface: "todos", object: "42", recipient: null }, { title: false }, null, "ordinary").draft;
  const independent = edit(seed, "independent");
  const bytes = JSON.stringify({ version: 1, drafts: [incompatible, independent] }, null, 2);
  localStorage.setItem(key, bytes);
  const authority = createProjectDrafts();
  const drafts = authority("/project/a");
  const observations: ReturnType<typeof drafts.problem>[] = [];

  const stop = createRoot((dispose) => {
    for (const [index, consumer] of [drafts, authority("/project/a")].entries()) createComputed(() => {
      observations[index] = consumer.problem();
    });

    return dispose;
  });

  const failure = { project: "/project/a", destination: incompatible.destination, revision: incompatible.revision, operation: "restore", cause: "invalid" };
  expect(drafts.validate("todos", v.object({ title: v.string() }))).toEqual(failure);
  expect(observations).toEqual([failure, failure]);
  const a = drafts.edit(incompatible.destination, { title: "submitted" }, null, "ordinary").draft;
  expect(drafts.submit(a.revision)?.problem).toEqual(failure);
  const b = drafts.edit(incompatible.destination, { title: "  新 e\u0301 🧭\n", choices: ["b", "a"] }, { start: 2, end: 5, direction: "backward" }, "ordinary").draft;
  expect(drafts.problem()).toEqual(failure);
  expect(drafts.settle(a.revision, "failed")).toEqual(failure);
  expect(drafts.discard(a.revision)).toEqual(failure);
  expect(drafts.retry()).toEqual(failure);
  expect(drafts.problem()).toEqual(failure);
  expect(observations).toEqual([failure, failure]);
  expect(localStorage.getItem(key)).toBe(bytes);
  expect(drafts.list()).toEqual([independent, b]);
  // Repair is external and explicit; retry merges its independent revision.
  const external = { ...independent, revision: "external", value: { text: "repair" } };
  localStorage.setItem(key, JSON.stringify({ version: 1, drafts: [external] }));
  expect(drafts.retry()).toBeNull();
  expect(draftStorage("/project/a").list()).toEqual([external, independent, b]);
  expect(observations).toEqual([null, null]);
  stop();
});

it.each(["before", "after"])("u2773e_storage_failure_keeps_memory_when_repair_has_same_revision_%s_registration", (timing) => {
  const key = "roundup:drafts:/project/a";
  const seed = draftStorage("/project/a");
  const original = seed.edit({ surface: "todos", object: "42", recipient: null }, { title: false }, null, "ordinary").draft;
  const drafts = draftStorage("/project/a");

  if (timing === "before") drafts.validate("todos", v.object({ title: v.string() }));
  const repaired = JSON.stringify({ version: 1, drafts: [{ ...original, value: { title: "repaired" } }] });
  localStorage.setItem(key, repaired);

  if (timing === "after") expect(drafts.validate("todos", v.object({ title: v.string() }))).toMatchObject({ operation: "restore", destination: original.destination, revision: original.revision });
  expect(drafts.retry()?.operation).toBe("restore");
  expect(localStorage.getItem(key)).toBe(repaired);
  expect(drafts.list()).toEqual([original]);
  drafts.discard(original.revision);
  expect(localStorage.getItem(key)).toBe(repaired);
  expect(drafts.retry()).toBeNull();
  expect(draftStorage("/project/a").list()).toEqual([]);
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

// The existing emulator edge runs inside the mounted Project context: consumers
// observe the same public holder that surface owners will use, without a new App seam.
const openDraftProjects = async () => {
  const directory = mkdtempSync(join(tmpdir(), "roundup-drafts-"));
  const paths = [join(directory, "a"), join(directory, "b")];
  const app = createFakeApp();
  const seen: ConnectedProject[] = [];
  let header: { drafts: ReturnType<typeof import("./connectedProject").createProjectDrafts> | undefined; connected: ConnectedProject | undefined } | undefined;
  const setWindowTitle = app.setWindowTitle;

  // WindowBar invokes this existing App seam from outside ConnectedProjectContext.
  app.setWindowTitle = async (title) => {
    header ??= { drafts: useContext(ProjectDraftsContext), connected: useContext(ConnectedProjectContext) };
    await setWindowTitle(title);
  };

  const emulators = fakeEmulators();

  for (const [index, path] of paths.entries()) {
    mkdirSync(path);
    app.add(path);
    app.of(path).handlers["rail.tree"] = () => [terminal(`editor-${index}`)];
    app.of(path).handlers["terminal.list"] = () => [info(`t-editor-${index}`)];
  }

  const view = render(() => createComponent(App, {
    app, reducedMotion: () => false, clock: () => 0,
    createEmulator: (id) => {
      seen.push(useConnectedProject());

      return emulators.factory(id);
    },
  }));

  const select = async (index: number) => {
    const tabs = within(await screen.findByRole("tablist", { name: "Projects" })).getAllByRole("tab");
    fireEvent.click(tabs[index]!);
    fireEvent.click(await waitFor(() => within(screen.getByRole("tree", { name: "Rail" })).getByText(`editor-${index}`)));
    await waitFor(() => expect(seen.at(-1)?.project.path).toBe(paths[index]));

    return seen.at(-1)!;
  };

  return { app, paths, select, header: () => header, close: () => { view.unmount(); rmSync(directory, { recursive: true, force: true }); } };
};

it.each(["pending", "failed", "unknown"] as const)("u2773a_shared_project_restores_exact_work_across_switch_and_connection_replacement_%s", async (status) => {
  const opened = await openDraftProjects();

  try {
    const first = await opened.select(0);
    const a = first.drafts.edit(target, { text: " A\ne\u0301 😀 ", choices: ["second", "first"] }, { start: 2, end: 5, direction: "backward" }, "ordinary").draft;
    first.drafts.submit(a.revision);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const b = first.drafts.edit(target, { text: " B\n😀 " }, null, "ordinary").draft;
    const other = await opened.select(1);
    const elsewhere = edit(other.drafts, "other Project");

    if (status !== "pending") first.drafts.settle(a.revision, status);
    const returned = await opened.select(0);
    expect(returned.drafts.list()).toEqual([{ ...a, status }, b]);
    opened.app.exitDaemon({ code: 1 }, opened.paths[0]);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull());
    const replaced = await opened.select(0);
    expect(replaced).not.toBe(first);
    expect(replaced.drafts.list()).toEqual([{ ...a, status }, b]);
    const newer = edit(replaced.drafts, "newest");
    first.drafts.settle(a.revision, "acknowledged");
    expect(replaced.drafts.list()).toEqual([newer]);
    expect(other.drafts.list()).toEqual([elsewhere]);
    const focus = document.activeElement;
    const before = opened.paths.map((path) => opened.app.of(path!).calls.length);
    write.mockRestore();
    expect(replaced.drafts.retry()).toBeNull();
    expect(draftStorage(replaced.project.path).list()).toEqual([newer]);
    expect(document.activeElement).toBe(focus);
    expect(opened.paths.map((path) => opened.app.of(path!).calls.length)).toEqual(before);
    const submits = new Set(["ask.send", "terminal.write", "decision.answer", "message.send"]);
    expect(opened.paths.flatMap((path) => opened.app.of(path!).calls).filter((call) => submits.has(call.method))).toEqual([]);
  } finally { opened.close(); }
});

it("u2773h_shared_consumers_observe_capacity", async () => {
  const disk = new Map<string, string>();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => disk.get(key) ?? null);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => { disk.set(key, value); });
  const opened = await openDraftProjects();
  let stop = () => {};

  try {
    const connected = await opened.select(0);
    const authority = opened.header();
    expect(authority?.drafts).toBeDefined();
    expect(authority?.connected).toBeUndefined();
    const header = authority!.drafts!(connected.project.path);
    expect(header).toBe(connected.drafts);
    const observations: { records: ReturnType<typeof connected.drafts.list>; problem: ReturnType<typeof connected.drafts.problem> }[] = [];
    createRoot((dispose) => {
      stop = dispose;

      // Independent readers track the same holder, as two mounted surface owners do.
      for (const [index, owner] of [header, connected.drafts].entries()) createComputed(() => {
        observations[index] = { records: owner.list(), problem: owner.problem() };
      });
    });
    const a = edit(connected.drafts, "a".repeat(6 * 1024 * 1024));
    connected.drafts.submit(a.revision);
    const before = disk.get(`roundup:drafts:${connected.project.path}`);
    const b = connected.drafts.edit({ ...target, surface: "changes" }, { text: "b".repeat(5 * 1024 * 1024) }, null, "ordinary").draft;

    for (const observation of observations) {
      expect(observation.records).toEqual([{ ...a, status: "pending" }, b]);
      expect(observation.problem).toEqual({ project: connected.project.path, destination: b.destination, revision: b.revision, operation: "retain", cause: "capacity" });
    }

    expect(disk.get(`roundup:drafts:${connected.project.path}`)).toBe(before);
    connected.drafts.discard(a.revision);

    for (const observation of observations) {
      expect(observation.records).toEqual([b]);
      expect(observation.problem).toBeNull();
    }
  } finally { stop(); opened.close(); }
});

it("u2773e_shared_project_credentials_stay_memory_only_across_replacement", async () => {
  const opened = await openDraftProjects();

  try {
    const first = await opened.select(0);
    const secret = first.drafts.edit({ ...target, surface: "credential" }, { text: "sentinel-shared-2812" }, null, "credential").draft;
    opened.app.exitDaemon({ code: 1 }, opened.paths[0]);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull());
    const replaced = await opened.select(0);
    expect(replaced.drafts.list()).toEqual([secret]);
    expect(draftStorage(replaced.project.path).list()).toEqual([]);
    expect(JSON.stringify(localStorage)).not.toContain("sentinel-shared-2812");
  } finally { opened.close(); }
});
