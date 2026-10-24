// @vitest-environment jsdom
import * as v from "valibot";
import type { ChildProcess } from "node:child_process";
import { request } from "node:http";
import { build } from "vite";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import type { MockInstance } from "vitest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useContext } from "solid-js";
import { App } from "../App";
import { RpcError } from "../app/seam";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { realDaemon } from "./realDaemonPlugin";
import { PROOF, startRealDaemon } from "./realDaemonFixture";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createProjectDrafts, connectProject, ConnectedProjectContext, ProjectDraftsContext } from "../state/connectedProject";
import type { ConnectedProject } from "../state/connectedProject";
import type { RailNode } from "@contracts/agent/RailNode";
import { WorktreeControl } from "../changes/WorktreeControl";
import { openFile, saveNote } from "../changes/noteHarness";
import type { StartedDaemon } from "./realDaemonFixture";
import { openRecovery as openMenu, recoveryLabel } from "./recovery";


/** A row opens as left-unsent work and turns to Copy once its original is known gone, which waits on the Daemon's reads. */
const copyOf = (row: () => HTMLElement) => waitFor(() => within(row()).getByRole("button", { name: "Copy" }), { timeout: 15_000 });

describe("u144 the harness serves the App on a real Daemon", () => {
  let daemon: ChildProcess;

  let real: StartedDaemon;

  let dir: string;

  let base: string;

  beforeAll(async () => {
    real = await startRealDaemon({});
    ({ daemon, dir, base } = real);
  }, 120_000);

  afterAll(async () => {
    await real?.stop();
  });

  afterEach(cleanup);

  const mount = async () => {
    const app: AppSeam = createServedApp(base);
    const emulators = fakeEmulators();

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={emulators.factory} />);

    return { app, emulators };
  };

  it("u144_a_workstream_made_and_started_by_pointer_comes_from_the_daemon", async () => {
    const { app, emulators } = await mount();

    fireEvent.click((await screen.findAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ }))[0]!);

    const rail = await screen.findByRole("region", { name: "Rail" });

    await waitFor(() => expect(within(rail).getAllByText("workstream").length).toBeGreaterThan(0));
    await waitFor(() => expect(emulators.made.size).toBe(1), { timeout: 20_000 });

    const tree = JSON.stringify(await app.rpc("rail.tree", null));
    const terminals = await app.rpc("terminal.list", null);

    expect([tree.includes('"workstream"'), terminals.length]).toEqual([true, 1]);
    expect([...emulators.made.keys()]).toEqual(terminals.map((terminal) => terminal.id));
  }, 60_000);

  it("u144_the_choosers_answer_null_and_the_dock_badge_does_nothing", async () => {
    const app = createServedApp(base);

    expect([await app.chooseProjectPath(), await app.chooseSavePath("x.md"), await app.setDockBadge(3), (await app.projects())[0]?.path, await app.forProject(dir).daemonProof()]).toEqual([null, null, undefined, dir, PROOF]);
  });

  it("u144_a_method_the_daemon_rejects_reaches_the_caller_with_its_message", async () => {
    const app = createServedApp(base);

    const failure = await app.rpc("rail.startDoor", { id: "nowhere" }).then(
      () => null,
      (error: RpcError) => error,
    );

    expect([failure instanceof RpcError, failure?.message]).toEqual([true, "not found: an Agent that is gone"]);
  });

  it("u144_a_method_the_daemon_rejects_shows_its_message_in_the_mounted_app", async () => {
    const served = createServedApp(base);
    let held = false;
    const app: AppSeam = { ...served, subscribe: (onEvent) => served.subscribe((event) => (held ? undefined : onEvent(event))), forProject: () => app };
    const workstream = await served.rpc("rail.createWorkstream", { name: "doomed", parent: null });

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const rail = await screen.findByRole("region", { name: "Rail" });

    fireEvent.dblClick(await within(rail).findByText("doomed"));

    const field = await within(rail).findByRole("textbox");

    held = true;
    await served.rpc("rail.remove", { id: workstream.id });

    const rejected = await served.rpc("rail.rename", { id: workstream.id, name: "renamed" }).then(
      () => null,
      (error: RpcError) => error,
    );

    fireEvent.input(field, { target: { value: "renamed" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(rejected).toBeInstanceOf(RpcError);
    expect((await within(rail).findByRole("alert")).textContent).toContain(rejected!.message);
  }, 60_000);

  it("u144_it_listens_on_loopback_only_and_refuses_a_foreign_host", async () => {
    const url = new URL(`${base}/__daemon/open`);

    expect(["127.0.0.1", "localhost"]).toContain(url.hostname);

    const status = (host: string) =>
      new Promise<number>((done, fail) => {
        request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { host } }, (response) => {
          response.resume();
          done(response.statusCode ?? 0);
        })
          .on("error", fail)
          .end();
      });

    expect([await status(`127.0.0.1:${url.port}`), await status(`evil.example:${url.port}`)]).toEqual([200, 403]);
  });

  it("u144_vite_build_leaves_the_daemon_route_out_of_dist", async () => {
    const out = await mkdtemp(join(tmpdir(), "roundup-dist-"));

    try {
      await build({
        configFile: join(process.cwd(), "vite.config.ts"),
        root: process.cwd(),
        logLevel: "silent",
        plugins: [realDaemon({ project: dir, socket: join(dir, "rupd.sock"), proof: PROOF })],
        build: { outDir: out, emptyOutDir: true },
      });

      const files = (await readdir(out, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
      const texts = await Promise.all(files.map((entry) => readFile(join(entry.parentPath, entry.name), "utf8").catch(() => "")));

      expect(files.length).toBeGreaterThan(0);
      expect(texts.some((text) => text.includes("__daemon") || text.includes("loopback only"))).toBe(false);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 120_000);

  it("u144_seed_behaves_as_today_beside_the_daemon_route", async () => {
    cleanup();
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, "", "/harness.html?seed=agents-10");
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));

    const calls: string[] = [];
    const fetched = globalThis.fetch;

    globalThis.fetch = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(String(input));

        return fetched(input, init);
      },
      fetched,
    );

    try {
      await import("./harness");
      expect(await screen.findByRole("region", { name: "Rail" })).toBeTruthy();
      expect(window.__fake).toBeDefined();
      expect(calls.filter((call) => call.includes("__daemon"))).toEqual([]);
    } finally {
      globalThis.fetch = fetched;
      vi.unstubAllGlobals();
      document.body.innerHTML = "";
      window.history.pushState({}, "", "/");
    }
  });

  it("u144_closing_the_socket_fires_daemon_exited_and_the_header_says_so", async () => {
    await mount();
    await screen.findByRole("banner");

    daemon.stdin!.end();
    daemon.kill();

    expect(await screen.findByText("Daemon exited by signal", {}, { timeout: 20_000 })).toBeTruthy();
  }, 60_000);
});

describe("u2540 inspection and notes on the real Daemon", () => {
  const execute = promisify(execFile);

  let real: StartedDaemon;

  let logs: string;

  let connected: ConnectedProject;

  let first: RailNode;

  let second: RailNode;

  const git = (...args: string[]) => execute("git", ["-C", real.dir, ...args], { timeout: 30_000 });

  const mount = () => render(() => <ConnectedProjectContext.Provider value={connected}><WorktreeControl /></ConnectedProjectContext.Provider>);

  beforeAll(async () => {
    logs = await mkdtemp(join(tmpdir(), "u2540-claude-"));
    real = await startRealDaemon({ FAKE_CLAUDE_PROMPT_LOG: join(logs, "prompts.jsonl") });
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

    if (logs) await rm(logs, { recursive: true, force: true });
  });

  it("u2540a_tree_and_diff_use_only_the_selected_agents_worktree", async () => {
    mount();

    for (const node of [first, second]) {
      connected.rail.select(node.id);
      fireEvent.click(screen.getByRole("button", { name: node.worktree!.branch }));
      await openFile("same.ts");
      const comparison = await connected.app.rpc("agent.compareFile", { id: node.id, path: "same.ts" });
      expect(comparison.new).toMatchObject({ kind: "text", text: node.id === first.id ? "first source\n" : "second source\n" });
      fireEvent.click(screen.getByRole("button", { name: "Add note" }));
      fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "check selected source" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }

    cleanup();
  });

  it("u2540c_real_message_respects_existing_delivery", async () => {
    mount();
    const { app } = connected;
    connected.rail.select(first.id);
    fireEvent.click(screen.getByRole("button", { name: first.worktree!.branch }));
    await openFile("same.ts");
    // Retire the inspection-only note from the prior observer; this batch holds exactly two new notes.
    fireEvent.click(screen.getByRole("button", { name: "Remove note 1" }));
    await saveNote("first exact comment");
    await saveNote("second exact comment");
    await app.rpc("takeover.begin", { agent: first.id });
    fireEvent.click(screen.getByRole("button", { name: "Send notes to First" }));
    const messages = () => app.rpc("message.list", { to: first.id, status: null });
    await waitFor(async () => expect(await messages()).toHaveLength(1), { timeout: 20_000 });
    const accepted = (await messages())[0]!;
    expect(accepted).toMatchObject({ to: first.id, from: { kind: "user", id: "you" }, kind: "note", status: "held", reason: "takeover" });
    expect(JSON.parse(accepted.body)).toMatchObject({ notes: [
      { "Selected source:": "first source", "User comment:": "first exact comment" },
      { "Selected source:": "first source", "User comment:": "second exact comment" },
    ] });
    expect(await app.rpc("message.list", { to: second.id, status: null })).toHaveLength(0);
    await app.rpc("takeover.end", { agent: first.id });
    await waitFor(async () => expect((await messages())[0]?.status).toBe("delivered"), { timeout: 30_000 });
    const prompts = await readFile(join(logs, "prompts.jsonl"), "utf8");
    expect(prompts).toContain("rup messages:");
    expect((await messages())[0]?.body).toBe(accepted.body);
    // Reopen on the same real Project: the Worktree change is still inspectable after the Message was accepted.
    cleanup();
    connected = await connectProject(app, { name: "observer", path: real.dir }, () => true, () => 0);
    connected.rail.select(first.id);
    mount();
    fireEvent.click(screen.getByRole("button", { name: first.worktree!.branch }));
    await openFile("same.ts");
    expect(screen.getByRole("button", { name: "Add note" })).toBeTruthy();
  }, 60_000);

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
      for (const phase of ["before inspection", "after close", "with notes"]) {
        const source = `${phase} source\n`;
        await writeFile(join(path, "same.ts"), source);
        await worktreeGit("add", "same.ts");
        await worktreeGit("commit", "-m", phase);

        if (phase !== "before inspection") {
          fireEvent.click(screen.getByRole("button", { name: node.worktree!.branch }));
          await openFile("same.ts");

          if (phase === "with notes") await saveNote("optional unsent note");
          fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
          await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        }

        const landed = await app.rpc("agent.land", { id: node.id });
        expect(landed.base).toBe((await git("rev-parse", "HEAD")).stdout.trim());
        expect((await git("show", "HEAD:same.ts")).stdout).toBe(source);
      }

      expect(calls.mock.calls.filter(([method]) => method === "agent.land")).toHaveLength(3);
      expect(calls.mock.calls.filter(([method]) => method === "message.send")).toHaveLength(0);
      expect(await app.rpc("message.list", { to: node.id, status: null })).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: node.worktree!.branch }));
      expect((await screen.findByRole("list", { name: "Notes" })).textContent).toContain("optional unsent note");
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
  let otherOriginal: RailNode;
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
    const other = createServedApp(second.base);
    otherOriginal = await other.rpc("rail.createWorkstream", { name: `same name ${seed}`, parent: null });

    if (otherOriginal.id === original.id) {
      await other.rpc("rail.remove", { id: otherOriginal.id });
      otherOriginal = await other.rpc("rail.createWorkstream", { name: `same name ${seed}`, parent: null });
    }

    const roots = [first, second];
    const live = new Map(roots.map((root) => [root.dir, createServedApp(root.base)]));
    let opened = [first.dir];
    const closed = new Set<string>();
    calls = [...live.values()].map((bound) => vi.spyOn(bound, "rpc"));
    app = {
      ...served,
      projects: async () => opened.map((path) => ({ name: path === first.dir ? "first" : "second", path, running: true })),
      forProject: (path) => live.get(path)!,
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
    holder.submit(saved.revision);
    holder.settle(saved.revision, "failed");
    const separate = drafts(second.dir).edit({ surface: "pads", object: other.incarnation, recipient: null }, { originalName: other.name, source: "other", base: other.text }, null, "ordinary").draft;
    drafts(second.dir).submit(separate.revision);
    drafts(second.dir).settle(separate.revision, "failed");
    mount();
    const recovery = await openRecovery();
    const row = () => within(recovery).getByRole("listitem");
    expect(within(row()).getByRole("button", { name: "Open" })).toBeTruthy();
    expect(within(row()).queryByRole("button", { name: "Copy" })).toBeNull();
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    await firstApp.rpc("pad.delete", { name: pad.name });
    const replacementPad = await firstApp.rpc("pad.create", { name: pad.name, text: "replacement" });
    expect(replacementPad.incarnation).not.toBe(pad.incarnation);
    const copyButton = await within(recovery).findByRole("button", { name: "Copy" });
    expect(within(row()).queryByRole("button", { name: "Open" })).toBeNull();
    fireEvent.click(copyButton);
    expect(clipboard).toHaveBeenCalledWith(exact);
    expect(holder.list().map((draft) => draft.revision)).toEqual([saved.revision]);
    expect(holder.list()[0]?.value.source).toBe(exact);
    expect(drafts(second.dir).list().map((draft) => draft.revision)).toEqual([separate.revision]);
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    const otherRecovery = await openRecovery();
    expect(otherRecovery.querySelector(`[data-revision="${separate.revision}"]`)).toBeTruthy();
    expect(otherRecovery.querySelector(`[data-revision="${saved.revision}"]`)).toBeNull();
    noDelivery();
  }, 60_000);

  it("u2773e_recovery_actions_keep_surface_draft", async () => {
    await setup();
    const pad = await app.forProject(first.dir).rpc("pad.create", { name: `recovery-${seed}`, text: "base" });
    const holder = drafts(first.dir);
    const destination = { surface: "pads", object: pad.incarnation, recipient: null };
    const older = holder.edit(destination, { originalName: pad.name, source: "older\n", base: pad.text }, null, "ordinary").draft;
    holder.submit(older.revision);
    holder.settle(older.revision, "failed");
    const separate = drafts(second.dir).edit(destination, { source: "other Project" }, null, "ordinary").draft;
    const write = Storage.prototype.setItem;


    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("roundup:drafts:")) throw new Error("disk full");
      write.call(this, key, value);
    });

    const newer = holder.edit(destination, { originalName: pad.name, source: exact, base: pad.text }, null, "ordinary").draft;
    mount();
    await openRecovery();
    expect((await screen.findByRole("alert")).textContent).toContain("Could not store unfinished work");
    expect([...document.querySelectorAll<HTMLElement>(".draft-revisions > li")].map((row) => row.dataset.revision).sort()).toEqual([older.revision, newer.revision].sort());
    calls.forEach((spy) => spy.mockClear());
    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(holder.list().find((draft) => draft.revision === newer.revision)).toEqual(newer);
    // Stored again, newer is no longer at risk but stays listed as left unsent.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    fireEvent.click(within(document.querySelector<HTMLElement>(`.draft-revisions > li[data-revision="${older.revision}"]`)!).getByRole("button", { name: "Discard" }));
    expect(createProjectDrafts()(first.dir).list()).toEqual([newer]);
    expect(createProjectDrafts()(second.dir).list()).toEqual([separate]);
    expect(calls.flatMap((spy) => spy.mock.calls).filter(([method]) => !["pad.list", "todo.list", "todo.listHanded"].includes(method))).toEqual([]);
  }, 60_000);

  it("u2773h_shared_authority_survives_project_lifecycle", async () => {
    await setup();
    const holder = drafts(first.dir);
    const saved = holder.edit(target(), { title: "same name", ask: exact, done: "  yes\n" }, { start: 2, end: 6, direction: "backward" }, "ordinary").draft;
    const independent = holder.edit({ surface: "todos", object: original.id, recipient: null }, { title: "independent 🧭" }, null, "ordinary").draft;
    holder.submit(saved.revision);
    holder.settle(saved.revision, "failed");
    const otherSaved = drafts(second.dir).edit({ surface: "orders", object: otherOriginal.id, recipient: otherOriginal.id }, { ask: "other Project" }, null, "ordinary").draft;
    drafts(second.dir).submit(otherSaved.revision);
    drafts(second.dir).settle(otherSaved.revision, "failed");
    expect(holder.problem()).toBeNull();
    const connection = await connectProject(app.forProject(first.dir), { name: "first", path: first.dir }, () => true, () => 0, () => null, undefined, drafts(first.dir));
    expect(connection.drafts).toBe(holder);
    connection.stopTerminalScheme();
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    mount();
    await vi.waitFor(async () => expect(await recoveryLabel()).not.toBeNull());
    expect(document.activeElement).toBe(outside);
    outside.remove();
    const focus = document.activeElement;
    holder.retry();
    expect(document.activeElement).toBe(focus);
    const firstRecovery = await openRecovery();
    expect(firstRecovery.querySelector(`[data-revision="${saved.revision}"]`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    const secondRecovery = await openRecovery();
    expect(secondRecovery.querySelector(`[data-revision="${saved.revision}"]`)).toBeNull();
    expect(secondRecovery.querySelector(`[data-revision="${otherSaved.revision}"]`)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "first" }));
    cleanup();
    drafts = createProjectDrafts();
    mount();
    await openRecovery();
    expect(drafts(first.dir).list().map((draft) => draft.revision)).toEqual([saved.revision, independent.revision]);
    expect(drafts(second.dir).list()[0]?.value).toEqual({ ask: "other Project" });
    noDelivery();
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
      holder.discard(incompatible.revision);
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
    expect((await screen.findByRole("alert")).textContent).toContain(kind === "surface" ? "Could not restore" : "Could not store");
    expect(headerFactory).toBe(drafts);
    const header = headerFactory!(first.dir);
    expect(header).toBe(holder);
    const headerSaved = header.edit({ surface: "header", object: first.dir, recipient: null }, { name: "  original e\u0301 🪁  " }, { start: 2, end: 5, direction: "backward" }, "ordinary").draft;
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    // This native seam ends the original real Daemon; the App removes its Connection.
    fireEvent.pointerEnter(screen.getByRole("tab", { name: "first" }).closest(".project-tab")!);
    fireEvent.click(screen.getByRole("button", { name: "Close first" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "first" })).toBeNull());
    expect(drafts(first.dir)).toBe(header);
    expect(header.list()).toEqual([saved, headerSaved]);

    if (kind === "surface") {
      expect(header.problem()).toEqual({ project: first.dir, destination: incompatible.destination, revision: incompatible.revision, operation: "restore", cause: "invalid" });
      expect(header.retry()?.operation).toBe("restore");
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
      expect(screen.getByRole("alert")).toBeTruthy();
      localStorage.setItem(key, JSON.stringify({ version: 1, drafts: [] }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(createProjectDrafts()(first.dir).list()).toEqual([saved, headerSaved]);
    noDelivery();
  }, 60_000);

  it("u2773h_settlement_keeps_other_revisions", async () => {
    await setup();
    const holder = drafts(first.dir);
    const a = holder.edit(target(), { ask: "A" }, null, "ordinary").draft;
    holder.submit(a.revision);
    const b = holder.edit(target(), { ask: exact }, null, "ordinary").draft;
    mount();
    await screen.findByRole("tab", { name: "first" });
    // B was left unsent and A is in flight: only B lists (U3289a).
    expect(await recoveryLabel()).toBe("Recover unfinished work (1)");
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    holder.settle(a.revision, "failed");
    expect(holder.list()).toEqual([expect.objectContaining({ revision: a.revision, status: "failed" }), b]);
    holder.settle(a.revision, "unknown");
    fireEvent.click(screen.getByRole("tab", { name: "first" }));
    const unknown = await openRecovery();
    expect(within(unknown.querySelector<HTMLElement>(`[data-revision="${a.revision}"]`)!).getByRole("img", { name: "may not have saved" })).toBeTruthy();
    expect(holder.list().find((draft) => draft.revision === b.revision)).toEqual(b);
    holder.settle(a.revision, "acknowledged");
    expect(holder.list()).toEqual([b]);
    noDelivery();
  }, 60_000);

  it("u2773h_unavailable_original_remains_recoverable", async () => {
    await setup();
    const holder = drafts(first.dir);
    const a = holder.edit(target(), { ask: "older exact\n" }, null, "ordinary").draft;
    holder.submit(a.revision);
    holder.settle(a.revision, "failed");
    const b = holder.edit(target(), { ask: exact }, null, "ordinary").draft;
    mount();
    await vi.waitFor(async () => expect(await recoveryLabel()).not.toBeNull());
    await app.forProject(first.dir).rpc("rail.remove", { id: original.id });
    const recovery = await openRecovery();
    const rowOf = (revision: string) => recovery.querySelector<HTMLElement>(`[data-revision="${revision}"]`)!;
    await waitFor(() => expect(rowOf(b.revision)).toBeTruthy());
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fireEvent.click(await copyOf(() => rowOf(b.revision)));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(exact));
    fireEvent.click(within(rowOf(a.revision)).getByRole("button", { name: "Discard" }));
    expect(holder.list().find((draft) => draft.revision === b.revision)).toEqual(b);
    cleanup();
    drafts = createProjectDrafts();
    mount();
    const reopened = await openRecovery();
    expect(drafts(first.dir).list()).toEqual([b]);
    expect(reopened.querySelector(`[data-revision="${a.revision}"]`)).toBeNull();
    expect(reopened.querySelector(`[data-revision="${b.revision}"]`)).toBeTruthy();
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
    await vi.waitFor(async () => expect(await recoveryLabel()).not.toBeNull());
    expect(document.activeElement).toBe(outside);
    const recovery = await openRecovery();
    expect(recovery.querySelector(`[data-revision="${saved.revision}"]`)).toBeTruthy();
    expect(drafts(first.dir).list()).toEqual([saved]);
    expect(emulators.made.has(terminal)).toBe(false);
    expect((await bound.rpc("terminal.list", null)).find((each) => each.id === terminal)?.running).not.toBe(true);
    const methods = calls.flatMap((spy) => spy.mock.calls.map(([method]) => method));
    expect(methods.filter((method) => method === "terminal.write" || method === "terminal.spawn" || method === "rail.startDoor")).toEqual([]);
    noDelivery();
    outside.remove();
  }, 60_000);



});
