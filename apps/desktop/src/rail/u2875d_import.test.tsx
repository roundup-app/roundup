import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportDiscovery } from "@contracts/project/ImportDiscovery";
import type { ImportResult } from "@contracts/project/ImportResult";
import { draftStorage } from "../state/storage";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { RpcError } from "../app/seam";
import { createFakeApp } from "../testing/fakeApp";
import { agent, workstream } from "../testing/nodes";
import { openTabs, tab, path } from "../header/stripFixture";
import { createImport } from "./importState";
import { exitedTerminal, mountRail, rowOf } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

const found = (revision = "r1"): ImportDiscovery => ({
  candidates: [
    { source: "s1", title: "First", cwd: "", last_activity_ms: 2n, revision },
    { source: "s2", title: "Second", cwd: "src", last_activity_ms: 1n, revision: "r2" },
  ],
  excluded: [{ source: "s3", reason: "already in this Project" }],
});

const calls = (app: Awaited<ReturnType<typeof mountRail>>["app"], method: string) => app.calls.filter((call) => call.method === method);

describe("u2875d the import panel is an ordinary Rail action", () => {
  it("u2875d_keyboard_pointer_and_recovery", async () => {
    const { app } = await mountRail([workstream("w1")]);
    let discovered = found();
    let commit: () => ImportResult = () => ({ outcomes: [{ source: "s1", workstream: "w1", agent: "a1", error: null }, { source: "s2", workstream: null, agent: null, error: "disk full" }] });
    app.handlers["project.importDiscover"] = () => discovered;
    app.handlers["project.importCommit"] = () => commit();

    // Cancel changes nothing: only discovery was called.
    fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
    await screen.findByText("First");
    fireEvent.click(screen.getByText("First"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "Import Claude Code work" })));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Import Claude Code work" }), { key: "Escape", code: "Escape", keyCode: 27 });
    await waitFor(() => expect(screen.queryByText("First")).toBeNull());
    expect(app.calls.filter((call) => call.method !== "project.importDiscover" && call.method.startsWith("project.")).length).toBe(0);

    // A rejected call keeps the selection and the panel.
    fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
    await screen.findByText("First");
    fireEvent.click(screen.getByText("First"));
    fireEvent.click(screen.getByText("Second"));
    commit = () => { throw new RpcError(-32000, "daemon refused"); };

    fireEvent.click(await screen.findByRole("button", { name: "Import 2" }));
    await screen.findByText("daemon refused");
    expect(screen.getByRole("button", { name: "Import 2" })).toBeTruthy();

    // Partial failure: the success leaves the selection, the failure stays for retry, and each call names its sources.
    commit = () => ({ outcomes: [{ source: "s1", workstream: "w1", agent: "a1", error: null }, { source: "s2", workstream: null, agent: null, error: "disk full" }] });
    fireEvent.click(await screen.findByRole("button", { name: "Import 2" }));
    await screen.findByText("disk full");
    expect(calls(app, "project.importCommit").map((call) => call.params)).toEqual([
      { selections: [{ source: "s1", revision: "r1" }, { source: "s2", revision: "r2" }] },
      { selections: [{ source: "s1", revision: "r1" }, { source: "s2", revision: "r2" }] },
    ]);

    // Retry targets the failed source only, and a pending confirm cannot submit twice.
    let release: (result: ImportResult) => void = () => undefined;
    app.handlers["project.importCommit"] = () => new Promise<ImportResult>((resolve) => { release = resolve; });
    const retry = screen.getByRole("button", { name: "Import 1" });
    await waitFor(() => expect(retry).toHaveProperty("disabled", false));
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(calls(app, "project.importCommit").length).toBe(3));
    expect(calls(app, "project.importCommit")[2]!.params).toEqual({ selections: [{ source: "s2", revision: "r2" }] });
    release({ outcomes: [{ source: "s2", workstream: "w1", agent: "a2", error: null }] });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import Claude Code work" })).toBeNull());
    expect(calls(app, "project.importCommit").length).toBe(3);
  });

  it("u2875d_late_acknowledgement_preserves_newer_selection_across_project_close_and_reopen", async () => {
    const { app } = await openTabs({ api: [workstream("w1")], web: [] });
    fireEvent.click(tab("api"));
    await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
    const daemon = app.of(path("api"));
    let release!: (result: ImportResult) => void;
    daemon.handlers["project.importDiscover"] = () => found();
    daemon.handlers["project.importCommit"] = () => new Promise<ImportResult>((resolve) => { release = resolve; });

    fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
    fireEvent.click(await screen.findByText("First"));
    fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));

    const reopen = async () => {
      fireEvent.click(screen.getByLabelText("Close api"));
      await waitFor(() => expect(screen.queryByRole("tab", { name: /^api/ })).toBeNull());
      app.chooser.path = path("api");
      fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
      await waitFor(() => expect(tab("api").getAttribute("aria-busy")).toBe("false"));
    };

    await reopen();
    const refresh = screen.queryByRole("button", { name: "Refresh" });

    if (refresh) fireEvent.click(refresh);
    fireEvent.click(await screen.findByText("Second"));
    release({ outcomes: [{ source: "s1", workstream: "w1", agent: "a1", error: null }] });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Import 2" })).toBeNull());
    await reopen();
    expect(await screen.findByRole("button", { name: "Import 1" })).toBeTruthy();
    expect(daemon.calls.filter((call) => call.method === "project.importCommit")).toHaveLength(1);
    cleanup();

    const restored = createImport(daemon, path("api"), () => undefined);

    expect([...restored.selected().keys()]).toEqual(["s2"]);
  });

  it("u2875d_acknowledgement_does_not_consume_a_reselected_revision", async () => {
    const app = createFakeApp();
    let release!: (result: ImportResult) => void;

    app.handlers["project.importDiscover"] = () => found();
    app.handlers["project.importCommit"] = () => new Promise<ImportResult>((resolve) => { release = resolve; });
    const state = createImport(app, "/p", () => undefined);

    state.show();
    await waitFor(() => expect(state.verified()).toBe(true));
    state.choose("s1", "First", "r1", true);
    const pending = state.confirm();

    state.choose("s1", "First", "r1", false);
    state.choose("s1", "First", "r1", true);
    release({ outcomes: [{ source: "s1", workstream: "w1", agent: "a1", error: null }] });
    await pending;
    expect([...state.selected().keys()]).toEqual(["s1"]);
  });

  it("u2875d_retention_failure_warns_and_keeps_selection_across_navigation", async () => {
    const { app } = await openTabs({ api: [], web: [] });
    fireEvent.click(tab("api"));
    await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
    const daemon = app.of(path("api"));
    daemon.handlers["project.importDiscover"] = () => found();
    fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
    await screen.findByText("First");
    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });

    try {
      fireEvent.click(screen.getByText("First"));
      await screen.findByText(/Import choices.*could not be saved for reload/);
      fireEvent.click(tab("web"));
      await waitFor(() => expect(tab("web").getAttribute("aria-selected")).toBe("true"));
      fireEvent.click(tab("api"));
      await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
      expect(screen.getByRole("button", { name: "Import 1" })).toBeTruthy();
      expect(screen.getByText(/Import choices.*could not be saved for reload/)).toBeTruthy();
      writes.mockRestore();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(screen.queryByText(/Import choices.*could not be saved for reload/)).toBeNull();
      cleanup();
      const restored = createImport(daemon, path("api"), () => undefined);
      expect([...restored.selected().keys()]).toEqual(["s1"]);
      expect(daemon.calls.filter((call) => call.method === "project.importCommit")).toEqual([]);
    } finally {
      writes.mockRestore();
    }
  });

  it("u2875d_restored_selection_never_submits_and_a_changed_source_needs_refresh", async () => {
    localStorage.setItem("roundup:import:/p", JSON.stringify({ open: true, period: "month", selected: [{ source: "s1", revision: "r1", title: "First" }] }));
    const { app } = await mountRail([workstream("w1")]);
    app.handlers["project.importDiscover"] = () => found("changed");
    app.handlers["project.importCommit"] = () => ({ outcomes: [] });

    await screen.findByText(/chosen earlier/);
    expect(app.calls.filter((call) => call.method.startsWith("project.import"))).toEqual([]);
    fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
    expect(calls(app, "project.importCommit")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText(/Changed or gone since you chose them: First/);
    expect(calls(app, "project.importDiscover").map((call) => call.params)).toEqual([{ period: "month" }]);
    expect(screen.getAllByRole("checkbox").every((box) => box instanceof HTMLInputElement && !box.checked)).toBe(true);
  });

  it("u2875d_success_opens_the_created_workstream_with_resume_and_start_supervisor", async () => {
    const { app } = await mountRail([workstream("w1"), agent("a1", "done", "done", { parent: "w1", can_resume: true })], [exitedTerminal("a1", 0)]);
    app.handlers["project.importDiscover"] = () => found();
    app.handlers["project.importCommit"] = () => ({ outcomes: [{ source: "s1", workstream: "w1", agent: "a1", error: null }] });

    fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
    fireEvent.click(await screen.findByText("First"));
    fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));

    await waitFor(() => expect(rowOf("a1").closest("[role=treeitem]")?.getAttribute("aria-selected")).toBe("true"));
    expect(rowOf("a1").querySelector("button[aria-label=Resume]")).toBeTruthy();
    fireEvent.focusIn(rowOf("w1").querySelector<HTMLElement>("button[aria-label=Collapse]")!);
    expect(screen.getByRole("button", { name: "Start supervisor" })).toBeTruthy();
    expect(calls(app, "agent.resume")).toEqual([]);
  });

  it("u2875d_period_and_selection_stay_with_their_original_project", async () => {
    const app = createFakeApp();
    app.handlers["project.importDiscover"] = () => found();
    const first = createImport(app, "/p", () => undefined);

    first.show();
    await waitFor(() => expect(first.verified()).toBe(true));
    first.setPeriod("month");
    first.choose("s1", "First", "r1", true);

    const other = createImport(app, "/q", () => undefined);

    expect([other.period(), other.selected().size, other.open()]).toEqual(["week", 0, false]);
    other.cancel();

    const reopened = createImport(app, "/p", () => undefined);

    expect([reopened.period(), [...reopened.selected().keys()], reopened.open(), reopened.verified()]).toEqual(["month", ["s1"], true, false]);
    expect(calls(app, "project.importCommit")).toEqual([]);
  });
});

const titles = ["一つ目 🪁 ".repeat(12), "別の窓 🌙 ".repeat(12), "三つ目 🌿 ".repeat(12)];

const concurrentFound = (): ImportDiscovery => ({ candidates: titles.map((title, at) => ({ source: `s${at + 1}`, revision: `preview-${at + 1}`, title, cwd: "", last_activity_ms: 1n })), excluded: [] });

const externalChoices = JSON.stringify({ open: true, period: "month", selected: [{ source: "s2", revision: "preview-2", title: titles[1] }] });

const importKey = (project = "/p") => `roundup:import:${project}`;

const clickSource = async (title: string) => {
  const box = screen.getByRole("checkbox", { name: new RegExp(title) });
  const selected = screen.getAllByRole("checkbox").filter(entry => entry instanceof HTMLInputElement && entry.checked).length;
  const count = selected + (box instanceof HTMLInputElement && box.checked ? -1 : 1);

  fireEvent.click(box);
  await screen.findByRole("button", { name: count ? `Import ${count}` : "Import" });
};

const importConflict = () => screen.getByRole("status", { name: /conflict/i });

it.each([false, true])("u3049a_external_save_keeps_both_versions_shared_record_%s", async (shared) => {
  const { app, connected } = await mountRail([]);
  app.handlers["project.importDiscover"] = concurrentFound;
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  await screen.findByRole("checkbox", { name: /一つ目/ });
  await clickSource("一つ目");
  let externalRevision: string | undefined;

  if (shared) {
    externalRevision = draftStorage("/p").edit({ surface: "import", object: "/p", recipient: null }, { period: "month", sources: ["s2"], revisions: ["preview-2"], titles: [titles[1]!] }, null, "ordinary").draft.revision;
  }

  localStorage.setItem("roundup:import:/p", JSON.stringify({ revision: externalRevision, open: true, period: "month", selected: [{ source: "s2", revision: "preview-2", title: titles[1] }] }));
  await clickSource("三つ目");
  expect(await screen.findByRole("status", { name: /conflict/i })).toBeTruthy();
  const forms = connected.drafts.list().filter(draft => draft.destination.surface === "import").map(draft => draft.value);
  expect(forms).toHaveLength(2);
  expect(forms).toEqual(expect.arrayContaining([
    expect.objectContaining({ period: "month", sources: ["s2"], revisions: ["preview-2"], titles: [titles[1]] }),
    expect.objectContaining({ period: "week", sources: ["s1", "s3"], revisions: ["preview-1", "preview-3"], titles: [titles[0], titles[2]] }),
  ]));
  expect(connected.importing.period()).toBe("week");
  expect([...connected.importing.selected().keys()]).toEqual(["s1", "s3"]);
  expect(calls(app, "project.importCommit")).toEqual([]);
});

it("u3049a_unchanged_record_saves_normally", async () => {
  const { app } = await mountRail([]);
  app.handlers["project.importDiscover"] = concurrentFound;
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  await screen.findByRole("checkbox", { name: /一つ目/ });
  await clickSource("一つ目");
  await clickSource("三つ目");
  expect(screen.queryByRole("status", { name: /conflict/i })).toBeNull();
  cleanup();
  const { connected } = await mountRail([]);
  expect([connected.importing.period(), [...connected.importing.selected()].map(([source, { revision, title }]) => [source, { revision, title }])]).toEqual(["week", [
    ["s1", { revision: "preview-1", title: titles[0] }], ["s3", { revision: "preview-3", title: titles[2] }],
  ]]);
  expect(connected.importing.choices()).toHaveLength(1);
});

const conflictingProjects = async () => {
  const { app } = await openTabs({ api: [], web: [] });
  const daemon = app.of(path("api"));
  daemon.handlers["project.importDiscover"] = concurrentFound;
  app.of(path("web")).handlers["project.importDiscover"] = concurrentFound;
  fireEvent.click(tab("web"));
  await waitFor(() => expect(tab("web").getAttribute("aria-selected")).toBe("true"));
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  await screen.findByRole("checkbox", { name: /別の窓/ });
  await clickSource("別の窓");
  const other = localStorage.getItem(importKey(path("web")));
  fireEvent.click(tab("api"));
  await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  await screen.findByRole("checkbox", { name: /一つ目/ });
  await clickSource("一つ目");
  localStorage.setItem(importKey(path("api")), externalChoices);
  await clickSource("三つ目");
  expect(importConflict()).toBeTruthy();

  return { app, daemon, other };
};

it("u3049b_reopen_keeps_conflicting_choices", async () => {
  const { app, daemon, other } = await conflictingProjects();
  fireEvent.click(tab("web"));
  await waitFor(() => expect(tab("web").getAttribute("aria-selected")).toBe("true"));
  fireEvent.click(tab("api"));
  await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
  // A read failure makes the storage-only retry control available without changing either form.
  const read = Storage.prototype.getItem;

  const reads = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
    if (key === importKey(path("api"))) throw new Error("unreadable");

    return read.call(this, key);
  });

  fireEvent.click(screen.getByRole("button", { name: "Open choices 1" }));
  reads.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  cleanup();
  render(() => <App app={app} reducedMotion={() => false} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await screen.findByRole("status", { name: /conflict/i });

  for (const [number, period, sources] of [[1, "month", ["s2"]], [2, "week", ["s1", "s3"]]] as const) {
    fireEvent.click(screen.getByRole("button", { name: `Open choices ${number}` }));
    expect(screen.getByRole("button", { name: `Last ${period}` }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: `Import ${sources.length}` })).toHaveProperty("disabled", true);
    expect(JSON.parse(localStorage.getItem(importKey(path("api")))!).selected).toEqual(sources.map(source => ({ source, revision: `preview-${source.slice(1)}`, title: titles[Number(source.slice(1)) - 1] })));
    expect(screen.getAllByRole("button", { name: /Open choices/ })).toHaveLength(2);
  }

  expect(localStorage.getItem(importKey(path("web")))).toBe(other);
  expect(calls(daemon, "project.importCommit")).toEqual([]);
  // Restored choices must first be validated, then explicitly confirmed.
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Import 2" })).toHaveProperty("disabled", false));
  expect(calls(daemon, "project.importCommit")).toEqual([]);
});

it.each([1, 2])("u3049b_discard_consumes_only_selected_version_%s", async (number) => {
  const { app, daemon, other } = await conflictingProjects();
  fireEvent.click(screen.getByRole("button", { name: `Discard choices ${number}` }));
  expect(screen.queryByRole("status", { name: /conflict/i })).toBeNull();
  cleanup();
  render(() => <App app={app} reducedMotion={() => false} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  const sources = number === 2 ? ["s2"] : ["s1", "s3"];

  await screen.findByRole("button", { name: `Import ${sources.length}` });
  expect(screen.getByRole("button", { name: number === 2 ? "Last month" : "Last week" }).getAttribute("aria-pressed")).toBe("true");
  expect(JSON.parse(localStorage.getItem(importKey(path("api")))!).selected).toEqual(sources.map(source => ({ source, revision: `preview-${source.slice(1)}`, title: titles[Number(source.slice(1)) - 1] })));
  expect(JSON.parse(localStorage.getItem(`roundup:drafts:${path("api")}`)!).drafts.filter((entry: { destination: { surface: string } }) => entry.destination.surface === "import")).toHaveLength(1);
  expect(localStorage.getItem(importKey(path("web")))).toBe(other);
  expect(calls(daemon, "project.importCommit")).toEqual([]);
});

it.each(["read", "json", "schema", "write", "draft-write"])("u3049b_retention_failure_keeps_conflicting_choices_%s", async (failure) => {
  const { app, connected } = await mountRail([]);
  app.handlers["project.importDiscover"] = concurrentFound;
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  await screen.findByRole("checkbox", { name: /一つ目/ });
  await clickSource("一つ目");
  localStorage.setItem(importKey(), externalChoices);
  const read = Storage.prototype.getItem;
  const write = Storage.prototype.setItem;

  if (failure === "json") localStorage.setItem(importKey(), "{");

  if (failure === "schema") localStorage.setItem(importKey(), '{"open":true}');
  const before = localStorage.getItem(importKey());

  const reads = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
    if (failure === "read" && key === importKey()) throw new Error("unreadable");

    return read.call(this, key);
  });

  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
    if ((failure === "write" && key === importKey()) || (failure === "draft-write" && key === "roundup:drafts:/p")) throw new Error("quota exceeded");
    write.call(this, key, value);
  });

  try {
    await clickSource("三つ目");
    expect(screen.getByText(/Import choices could not be/)).toBeTruthy();
    expect(read.call(localStorage, importKey())).toBe(before);
    expect([...connected.importing.selected()]).toEqual([["s1", { revision: "preview-1", title: titles[0] }], ["s3", { revision: "preview-3", title: titles[2] }]]);
  } finally {
    reads.mockRestore(); writes.mockRestore();
  }

  localStorage.setItem(importKey(), externalChoices);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(importConflict()).toBeTruthy();
  expect(connected.importing.choices().sort((a, b) => a.period.localeCompare(b.period)).map(entry => [entry.period, entry.sources, entry.revisions, entry.titles])).toEqual([
    ["month", ["s2"], ["preview-2"], [titles[1]]], ["week", ["s1", "s3"], ["preview-1", "preview-3"], [titles[0], titles[2]]],
  ]);
  expect(calls(app, "project.importCommit")).toEqual([]);
});


it.each(["discovery", "retry"])("u3049a_detects_external_record_before_%s_write", async (operation) => {
  const { app } = await mountRail([]);
  app.handlers["project.importDiscover"] = concurrentFound;
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  await screen.findByRole("checkbox", { name: /一つ目/ });
  await clickSource("一つ目");

  if (operation === "retry") {
    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });

    await clickSource("三つ目");
    writes.mockRestore();
  }

  localStorage.setItem(importKey(), externalChoices);
  fireEvent.click(screen.getByRole("button", { name: operation === "retry" ? "Try again" : "Refresh" }));
  await screen.findByRole("status", { name: /conflict/i });
  expect(screen.getAllByRole("button", { name: /Open choices/ })).toHaveLength(2);
  expect(calls(app, "project.importCommit")).toEqual([]);
});

it.each([false, true])("u3049b_initial_restore_retry_keeps_versions_separate_recovered_%s", async (recovered) => {
  localStorage.setItem(importKey(), externalChoices);
  const read = Storage.prototype.getItem;
  let unreadable = true;

  const reads = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
    if (key === importKey() && unreadable) throw new Error("unreadable");

    return read.call(this, key);
  });

  try {
    const { app, connected } = await mountRail([]);
    app.handlers["project.importDiscover"] = concurrentFound;
    fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
    await screen.findByRole("checkbox", { name: /一つ目/ });
    await screen.findByText(/Import choices could not be restored/);

    // A successful ordinary save must not leave retry in an initial-restore mode.
    if (recovered) {
      unreadable = false;
      localStorage.removeItem(importKey());
    }

    await clickSource("一つ目");
    localStorage.setItem(importKey(), externalChoices);
    unreadable = true;
    await clickSource("三つ目");
    expect(read.call(localStorage, importKey())).toBe(externalChoices);
    unreadable = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(importConflict()).toBeTruthy();
    expect(connected.importing.choices().sort((a, b) => a.period.localeCompare(b.period)).map(entry => [entry.period, entry.sources, entry.revisions, entry.titles])).toEqual([
      ["month", ["s2"], ["preview-2"], [titles[1]]], ["week", ["s1", "s3"], ["preview-1", "preview-3"], [titles[0], titles[2]]],
    ]);
    expect([connected.importing.period(), [...connected.importing.selected().keys()]]).toEqual(["week", ["s1", "s3"]]);
    cleanup();
    const reopened = await mountRail([]);
    expect(reopened.connected.importing.choices().map(entry => [entry.period, entry.sources])).toEqual(expect.arrayContaining([
      ["month", ["s2"]], ["week", ["s1", "s3"]],
    ]));
    expect(calls(app, "project.importCommit")).toEqual([]);
    expect(calls(reopened.app, "project.importCommit")).toEqual([]);
  } finally {
    reads.mockRestore();
  }
});

it("u3037d_timeout_keeps_selection_until_refresh_verifies_it", async () => {
  const app = createFakeApp();
  app.handlers["project.importDiscover"] = () => found();
  const state = createImport(app, "/deadline-project", () => {});
  await state.refresh();
  state.choose("s1", "First", "r1", true);
  app.handlers["project.importDiscover"] = () => new Promise(() => {});
  vi.useFakeTimers();

  try {
    void state.refresh();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.loading()).toBe(false);
    expect(state.failure()).toBeTruthy();
    expect(state.verified()).toBe(false);
    expect(state.selected().get("s1")?.revision).toBe("r1");
    app.handlers["project.importDiscover"] = () => found();
    await state.refresh();
    expect(state.verified()).toBe(true);
    expect(state.selected().get("s1")?.revision).toBe("r1");
    expect(app.calls.filter((call) => call.method === "project.importCommit")).toHaveLength(0);
  } finally { vi.useRealTimers(); }
});
