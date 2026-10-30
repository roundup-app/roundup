// @vitest-environment jsdom
import * as v from "valibot";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import type { MockInstance } from "vitest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useContext } from "solid-js";
import { RequestedApp as App } from "../testing/requestedApp";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createProjectDrafts, connectProject, ConnectedProjectContext, ProjectDraftsContext } from "../state/connectedProject";
import type { ConnectedProject } from "../state/connectedProject";
import type { RailNode } from "@contracts/agent/RailNode";
import { WorktreeControl } from "../changes/WorktreeControl";
import { openFile } from "../changes/noteHarness";
import type { StartedDaemon } from "./realDaemonFixture";
import { openRecovery as openMenu, recoveryLabel } from "./recovery";

/** A row opens as left-unsent work and turns to Copy once its original is known gone, which waits on the Daemon's reads. */
const copyOf = (row: () => HTMLElement) => waitFor(() => within(row()).getByRole("button", { name: "Copy" }), { timeout: 15_000 });

describe("u2540 inspection and notes on the real Daemon", () => {
  const execute = promisify(execFile);

  let real: StartedDaemon;

  let connected: ConnectedProject;

  let first: RailNode;

  let second: RailNode;

  const git = (...args: string[]) => execute("git", ["-C", real.dir, ...args], { timeout: 30_000 });

  const mount = () => render(() => {
    connected.worktrees.watch(() => true);

    return <ConnectedProjectContext.Provider value={connected}><WorktreeControl /></ConnectedProjectContext.Provider>;
  });

  beforeAll(async () => {
    real = await startRealDaemon({});
    await git("init", "-b", "main");
    await git("config", "user.name", "Diff observer");
    await git("config", "user.email", "diff@example.test");
    await writeFile(join(real.dir, "same.ts"), "base source\n");
    await git("add", "same.ts");
    await git("commit", "-m", "base");
    const app = createServedApp(real.base);

    await app.rpc("project.setWorktrees", { on: true, check: "true" });
    first = await app.rpc("agent.spawn", { cwd: real.dir, parent: null, prompt: null, name: "First", order: { kind: "work", ask: "inspect", limits: [] } });
    second = await app.rpc("agent.spawn", { cwd: real.dir, parent: null, prompt: null, name: "Second", order: { kind: "work", ask: "inspect", limits: [] } });
    await waitFor(async () => expect((await app.rpc("rail.tree", null)).filter(node => node.id === first.id || node.id === second.id).every(node => node.status?.kind === "idle")).toBe(true), { timeout: 30_000 });
    await writeFile(join(real.dir, "same.ts"), "project source\n");
    await writeFile(join(first.worktree!.path, "same.ts"), "first source\n");
    await writeFile(join(second.worktree!.path, "same.ts"), "second source\n");
    connected = await connectProject(app, { name: "observer", path: real.dir }, () => true, () => 0);
  }, 120_000);

  afterAll(async () => {
    cleanup();
    await real?.stop();
  });

  it("u2540a_tree_and_diff_use_only_the_selected_agents_worktree", async () => {
    mount();

    for (const node of [first, second]) {
      connected.rail.select(node.id);
      fireEvent.click(await screen.findByRole("button", { name: /\d+ changed files?/ }));
      await openFile("same.ts");
      const comparison = await connected.app.rpc("agent.compareFile", { id: node.id, path: "same.ts" });
      expect(comparison.new).toMatchObject({ kind: "text", text: node.id === first.id ? "first source\n" : "second source\n" });
      fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }

    cleanup();
  });

  it("u2540d_landing_is_independent_of_diff_and_notes", async () => {
    cleanup();
    const { app } = connected;
    const node = await app.rpc("agent.spawn", { cwd: real.dir, parent: null, prompt: null, name: "Landing", order: { kind: "work", ask: "inspect", limits: [] } });
    const path = node.worktree!.path;
    const worktreeGit = (...args: string[]) => execute("git", ["-C", path, ...args], { timeout: 30_000 });

    // The ownership observer intentionally dirtied the Project copy; Landing requires a clean Base.
    await git("checkout", "--", "same.ts");
    await waitFor(() => expect(connected.rail.nodes.some(each => each.id === node.id)).toBe(true));
    connected.rail.select(node.id);
    mount();
    const calls = vi.spyOn(app, "rpc");

    try {
      const unsent = "optional unsent note";

      for (const phase of ["before inspection", "after close", "with notes"]) {
        const source = `${phase} source\n`;
        await writeFile(join(path, "same.ts"), source);
        await worktreeGit("add", "same.ts");
        await worktreeGit("commit", "-m", phase);
        await connected.worktrees.refresh(node.id);

        if (phase !== "before inspection") {
          fireEvent.click(await screen.findByRole("button", { name: /\d+ changed files?/ }));
          await openFile("same.ts");

          if (phase === "with notes") {
            fireEvent.click(screen.getByRole("button", { name: "Add note" }));
            fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: unsent } });
            fireEvent.click(screen.getByRole("button", { name: "Save" }));
          }

          fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
          await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        }

        const landed = await app.rpc("agent.land", { id: node.id });
        expect(landed.base).toBe((await git("rev-parse", "HEAD")).stdout.trim());
        expect((await git("show", "HEAD:same.ts")).stdout).toBe(source);
      }

      expect(calls.mock.calls.filter(([method]) => method === "agent.land")).toHaveLength(3);
      expect(calls.mock.calls.filter(([method]) => method === "message.send")).toHaveLength(0);
      expect((await app.rpc("message.list", { to: node.id, status: null })).filter(message => message.from.kind === "user")).toHaveLength(0);
      connected.showView("notes");
      await screen.findByRole("dialog", { name: "Recover notes" });
      expect(document.querySelector(".note-recovery")?.textContent).toContain(unsent);
    } finally {
      calls.mockRestore();
      cleanup();
    }
  }, 60_000);

});

describe("u2773 Project draft integration on real Projects", () => {
  let first: StartedDaemon;
  let second: StartedDaemon;
  let drafts: ReturnType<typeof createProjectDrafts>;
  let app: AppSeam;
  let original: RailNode;
  let replacement: RailNode;
  let calls: MockInstance<AppSeam["rpc"]>[];
  const exact = "  original e\u0301 🪁\nlast line  ";
  const target = () => ({ surface: "orders", object: original.id, recipient: original.id });

  const openRecovery = async () => {
    await openMenu();

    return screen.findByRole("region", { name: "Unfinished work" });
  };

  const mount = (emulators = fakeEmulators()) => render(() => <App app={app} drafts={drafts} reducedMotion={() => true} clock={() => 0} createEmulator={emulators.factory} />);

  const noDelivery = () => {
    const methods = calls.flatMap((spy) => spy.mock.calls.map(([method]) => method));
    expect(methods.filter((method) => method === "agent.setOrder" || method === "message.send" || method === "agent.prompt" || method === "agent.spawn")).toEqual([]);
  };

  beforeAll(async () => {
    first = await startRealDaemon({});
    second = await startRealDaemon({});
  }, 240_000);
  afterAll(async () => { await first?.stop(); await second?.stop(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

  let seed = 0;

  const setup = async () => {
    seed++;

    // Each probe owns its sources; a prior probe's live Door must not become its recipient.
    for (const root of [first, second]) {
      const bound = createServedApp(root.base);

      for (const node of await bound.rpc("rail.tree", null)) {
        if (node.kind === "workstream" && node.parent === null) await bound.rpc("rail.remove", { id: node.id });
      }
    }

    window.localStorage.clear();
    drafts = createProjectDrafts();
    const served = createServedApp(first.base);
    original = await served.rpc("rail.createWorkstream", { name: `same name ${seed}`, parent: null });
    replacement = await served.rpc("rail.createWorkstream", { name: `replacement ${seed}`, parent: null });
    const roots = [first, second];
    const live = new Map(roots.map((root) => [root.dir, createServedApp(root.base)]));
    let opened = [first.dir];
    const closed = new Set<string>();
    calls = [...live.values()].map((bound) => vi.spyOn(bound, "rpc"));
    app = {
      ...served,
      projects: async () => opened.map((path) => ({ name: path === first.dir ? "first" : "second", path, running: true })),
      forProject: (path) => Object.assign(live.get(path)!, { writeClipboardText: (text: string) => app.writeClipboardText(text) }),
      chooseProjectPath: async () => opened.includes(second.dir) ? first.dir : second.dir,
      openProject: async (path) => {
        const root = roots.find((each) => each.dir === path)!;

        if (closed.delete(path)) {
          await root.restart();
          const bound = createServedApp(root.base);
          calls.push(vi.spyOn(bound, "rpc"));
          live.set(path, bound);
        }

        if (!opened.includes(path)) opened.push(path);

        return { name: path === first.dir ? "first" : "second", path };
      },
      closeProject: async (path) => {
        roots.find((each) => each.dir === path)!.daemon.kill();
        closed.add(path);
        opened = opened.filter((each) => each !== path);
      },
      onDaemonExited: async () => () => {},
    };
  };

  it("u2773c_pads_external_change_keeps_original", async () => {
    await setup();
    const firstApp = app.forProject(first.dir);
    const pad = await firstApp.rpc("pad.create", { name: `pad-${seed}`, text: "base\n" });
    const other = await app.forProject(second.dir).rpc("pad.create", { name: pad.name, text: "other" });
    const holder = drafts(first.dir);
    const saved = holder.edit({ surface: "pads", object: pad.incarnation, recipient: null }, { originalName: pad.name, source: exact, base: pad.text }, null, "ordinary").draft;
    await holder.submit(saved.revision);
    await holder.settle(saved.revision, "failed");
    const separate = drafts(second.dir).edit({ surface: "pads", object: other.incarnation, recipient: null }, { originalName: other.name, source: "other", base: other.text }, null, "ordinary").draft;
    await drafts(second.dir).submit(separate.revision);
    await drafts(second.dir).settle(separate.revision, "failed");
    mount();
    const recovery = await openRecovery();
    const row = () => within(recovery).getByRole("listitem");
    const opener = within(row()).getByRole<HTMLButtonElement>("button", { name: "Open" });
    expect(opener.disabled).toBe(false);
    const clipboard = vi.fn(async (_text: string) => {});
    vi.spyOn(app, "writeClipboardText").mockImplementation(clipboard);
    await firstApp.rpc("pad.delete", { name: pad.name });
    const replacementPad = await firstApp.rpc("pad.create", { name: pad.name, text: "replacement" });
    expect(replacementPad.incarnation).not.toBe(pad.incarnation);
    const copyButton = await within(recovery).findByRole("button", { name: "Copy" });
    expect(opener.isConnected).toBe(false);
    fireEvent.click(copyButton);
    expect(clipboard).toHaveBeenCalledWith(exact);
    expect(holder.list().map((draft) => draft.revision)).toEqual([saved.revision]);
    expect(holder.list()[0]?.value.source).toBe(exact);
    expect(drafts(second.dir).list().map((draft) => draft.revision)).toEqual([separate.revision]);
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    const otherRecovery = await openRecovery();
    expect([...otherRecovery.querySelectorAll<HTMLElement>("[data-revision]")].map(row => row.dataset.revision)).toEqual([separate.revision]);
    noDelivery();
  }, 60_000);

  it("u2773e_recovery_actions_keep_surface_draft", async () => {
    await setup();
    const pad = await app.forProject(first.dir).rpc("pad.create", { name: `recovery-${seed}`, text: "base" });
    const holder = drafts(first.dir);
    const destination = { surface: "pads", object: pad.incarnation, recipient: null };
    const older = holder.edit(destination, { originalName: pad.name, source: "older\n", base: pad.text }, null, "ordinary").draft;
    await holder.submit(older.revision);
    await holder.settle(older.revision, "failed");
    const independent = drafts(second.dir).edit(destination, { source: "other Project" }, null, "ordinary");
    await independent.retained;
    const separate = independent.draft;
    const write = Storage.prototype.setItem;

    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("roundup:drafts:")) throw new Error("disk full");
      write.call(this, key, value);
    });

    const newer = holder.edit(destination, { originalName: pad.name, source: exact, base: pad.text }, null, "ordinary").draft;
    mount();
    await openRecovery();
    await within(screen.getByLabelText("Unfinished work")).findByRole("alert");
    expect(holder.problem()).toMatchObject({ operation: "retain", cause: "write" });
    expect([...document.querySelectorAll<HTMLElement>(".draft-revisions > li")].map((row) => row.dataset.revision).sort()).toEqual([older.revision, newer.revision].sort());
    calls.forEach((spy) => spy.mockClear());
    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(holder.list().find((draft) => draft.revision === newer.revision)).toEqual(newer);
    // Stored again, newer is no longer at risk but stays listed as left unsent.
    await waitFor(() => expect(within(screen.getByLabelText("Unfinished work")).queryByRole("alert")).toBeNull());
    fireEvent.click(within(document.querySelector<HTMLElement>(`.draft-revisions > li[data-revision="${older.revision}"]`)!).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(createProjectDrafts()(first.dir).list()).toEqual([newer]));
    expect(createProjectDrafts()(second.dir).list()).toEqual([separate]);
    expect(calls.flatMap((spy) => spy.mock.calls).filter(([method]) => !["pad.list", "todo.list", "todo.listHanded"].includes(method))).toEqual([]);
  }, 60_000);

  it.each(["write", "surface"])("u2773h_retention_failure_preserves_closed_project_memory_%s", async (kind) => {
    await setup();
    const key = `roundup:drafts:${first.dir}`;
    const incompatible = { revision: "incompatible", destination: { surface: "todos", object: "42", recipient: null }, value: { title: false }, selection: null, status: "draft", policy: "ordinary" };
    const bytes = JSON.stringify({ version: 1, drafts: [incompatible] }, null, 2);

    if (kind === "surface") localStorage.setItem(key, bytes);
    const holder = drafts(first.dir);

    if (kind === "surface") {
      holder.validate("todos", v.object({ title: v.string() }));
      await holder.discard(incompatible.revision);
    }

    let headerFactory: typeof drafts | undefined;
    const setWindowTitle = app.setWindowTitle;

    app.setWindowTitle = async (title) => {
      headerFactory ??= useContext(ProjectDraftsContext);
      await setWindowTitle(title);
    };

    const write = Storage.prototype.setItem;

    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (kind === "write" && key.startsWith("roundup:drafts:")) throw new Error("disk full");

      write.call(this, key, value);
    });

    const saved = holder.edit(
      kind === "surface" ? incompatible.destination : target(),
      kind === "surface" ? { title: exact, body: "  complete form\n", choices: ["second", "first"] } : { ask: exact, title: "same name", done: "later" },
      { start: 3, end: 7, direction: "forward" }, "ordinary",
    ).draft;

    if (kind === "surface") expect(saved).toMatchObject({
      destination: { surface: "todos", object: "42", recipient: null },
      value: { title: exact, body: "  complete form\n", choices: ["second", "first"] },
      selection: { start: 3, end: 7, direction: "forward" },
    });
    mount();
    await openRecovery();
    await within(screen.getByLabelText("Unfinished work")).findByRole("alert");
    expect(holder.problem()?.operation).toBe(kind === "surface" ? "restore" : "retain");
    expect(headerFactory).toBe(drafts);
    const header = headerFactory!(first.dir);
    expect(header).toBe(holder);
    const headerSaved = header.edit({ surface: "header", object: first.dir, recipient: null }, { name: "  original e\u0301 🪁  " }, { start: 2, end: 5, direction: "backward" }, "ordinary").draft;
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    // This native seam ends the original real Daemon; the App removes its Connection.
    fireEvent.pointerEnter(screen.getByRole("tab", { name: "first" }).closest(".project-tab")!);
    fireEvent.click(screen.getByRole("button", { name: "Close first" }));
    await waitFor(async () => expect((await app.projects()).some(project => project.path === first.dir)).toBe(false));
    expect(drafts(first.dir)).toBe(header);
    expect(header.list()).toEqual([saved, headerSaved]);

    if (kind === "surface") {
      expect(header.problem()).toEqual({ project: first.dir, destination: incompatible.destination, revision: incompatible.revision, operation: "restore", cause: "invalid" });
      expect((await header.retry())?.operation).toBe("restore");
      expect(localStorage.getItem(key)).toBe(bytes);
    }

    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "first" });
    await openRecovery();
    expect(drafts(first.dir)).toBe(holder);
    expect(holder.list()).toEqual([saved, headerSaved]);

    if (kind === "surface") {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(localStorage.getItem(key)).toBe(bytes);
      expect(within(screen.getByLabelText("Unfinished work")).getByRole("alert")).toBeTruthy();
      localStorage.setItem(key, JSON.stringify({ version: 1, drafts: [] }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(screen.getByLabelText("Unfinished work")).queryByRole("alert")).toBeNull());
    expect(createProjectDrafts()(first.dir).list()).toEqual([saved, headerSaved]);
    noDelivery();
  }, 60_000);

  it("u2773h_unavailable_original_remains_recoverable", async () => {
    await setup();
    const holder = drafts(first.dir);
    const a = holder.edit(target(), { ask: "older exact\n" }, null, "ordinary").draft;
    await holder.submit(a.revision);
    await holder.settle(a.revision, "failed");
    const b = holder.edit(target(), { ask: exact }, null, "ordinary").draft;
    mount();
    await vi.waitFor(async () => expect(await recoveryLabel()).not.toBeNull(), { timeout: 15_000 });
    await app.forProject(first.dir).rpc("rail.remove", { id: original.id });
    const recovery = await openRecovery();
    const rowOf = (revision: string) => recovery.querySelector<HTMLElement>(`[data-revision="${revision}"]`)!;
    await waitFor(() => expect(rowOf(b.revision).dataset.revision).toBe(b.revision));
    const clipboard = vi.fn(async (_text: string) => {});
    vi.spyOn(app, "writeClipboardText").mockImplementation(clipboard);
    fireEvent.click(await copyOf(() => rowOf(b.revision)));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(`\n${exact}\n`));
    fireEvent.click(within(rowOf(a.revision)).getByRole("button", { name: "Discard" }));
    expect(holder.list().find((draft) => draft.revision === b.revision)).toEqual(b);
    cleanup();
    drafts = createProjectDrafts();
    mount();
    const reopened = await openRecovery();
    expect(drafts(first.dir).list()).toEqual([b]);
    expect([...reopened.querySelectorAll<HTMLElement>("[data-revision]")].map(row => row.dataset.revision)).toEqual([b.revision]);
    expect((await app.forProject(first.dir).rpc("rail.tree", null)).some((node) => node.id === replacement.id)).toBe(true);
    noDelivery();
  }, 60_000);

  it("u2773f_dead_vendor_is_not_reconstructed", async () => {
    await setup();
    const bound = app.forProject(first.dir);
    const source = await bound.rpc("rail.startDoor", { id: original.id });
    const terminal = source.terminal_id!;
    const initial = fakeEmulators();
    const mounted = mount(initial);
    await screen.findByRole("region", { name: "Rail" });
    await waitFor(() => expect(document.querySelector(`.rail-row[data-id="${source.id}"]`)).toBeTruthy());
    fireEvent.click(document.querySelector(`.rail-row[data-id="${source.id}"]`)!);
    await waitFor(() => expect(initial.made.has(terminal)).toBe(true));
    const saved = drafts(first.dir).edit({ surface: "terminal_selection", object: terminal, recipient: source.id }, { note: " retained 🧭  ", excerpt: " captured source\n", source: source.id, terminal, attempt: source.attempt }, null, "ordinary").draft;
    mounted.unmount();
    await bound.rpc("terminal.kill", { id: terminal });
    window.localStorage.setItem(`roundup:rail:${first.dir}`, JSON.stringify({ selected: source.id, collapsed: [] }));
    drafts = createProjectDrafts();
    const emulators = fakeEmulators();
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    calls.forEach((spy) => spy.mockClear());
    mount(emulators);
    await vi.waitFor(async () => expect(await recoveryLabel()).not.toBeNull(), { timeout: 15_000 });
    expect(document.activeElement).toBe(outside);
    const recovery = await openRecovery();
    expect(recovery.querySelector(`[data-revision="${saved.revision}"]`) instanceof HTMLElement).toBe(true);
    expect(drafts(first.dir).list()).toEqual([saved]);
    expect(emulators.made.has(terminal)).toBe(false);
    expect((await bound.rpc("terminal.list", null)).find((each) => each.id === terminal)?.running).not.toBe(true);
    const methods = calls.flatMap((spy) => spy.mock.calls.map(([method]) => method));
    expect(methods.filter((method) => method === "terminal.write" || method === "terminal.spawn" || method === "rail.startDoor")).toEqual([]);
    noDelivery();
    outside.remove();
  }, 60_000);

});
