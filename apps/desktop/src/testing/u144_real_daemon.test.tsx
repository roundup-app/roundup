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
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
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
          fireEvent.click(screen.getByRole("button", { name: "Close" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));

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

  // Fixture surface owner: its format and identity extraction stay outside shared recovery.
  const recoverSelections = () => drafts(first.dir).registerRecovery("terminal_selection", (draft, { rail, daemonExit }) => {
    if (daemonExit() || rail.terminalExit(draft.destination.object)) return "unavailable";

    if (rail.failure()) return "unverified";

    const source = rail.nodes.find((node) => node.id === draft.value.source);
    const terminal = rail.terminals().find((each) => each.id === draft.destination.object);

    return source?.attempt === draft.value.attempt && source?.terminal_id === draft.destination.object && terminal?.running ? "available" : "unavailable";
  });

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
    recoverSelections();
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
    await waitFor(() => expect([...document.querySelectorAll<HTMLElement>(".draft-revisions > li")].map((row) => row.dataset.revision)).toEqual([older.revision]));
    fireEvent.click(within(document.querySelector<HTMLElement>(".draft-revisions > li")!).getByRole("button", { name: "Discard" }));
    expect(createProjectDrafts()(first.dir).list()).toEqual([newer]);
    expect(createProjectDrafts()(second.dir).list()).toEqual([separate]);
    expect(calls.flatMap((spy) => spy.mock.calls).filter(([method]) => !["pad.list", "todo.list"].includes(method))).toEqual([]);
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
    const entry = await screen.findByRole("button", { name: "Recover unfinished work" });
    expect(document.activeElement).toBe(outside);
    outside.remove();
    entry.focus();
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
    expect(screen.queryByRole("button", { name: "Recover unfinished work" })).toBeNull();
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

  it.each(["answered", "dismissed", "replaced"] as const)("u2773d_original_prompt_refuses_replacement_recovery_%s", async (retirement) => {
    await setup();
    const bound = app.forProject(first.dir);
    const agent = await bound.rpc("rail.startDoor", { id: original.id });
    const signal = () => { void bound.rpc("agent.permission", { id: agent.id, payload: { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "git status" } } }).catch(() => undefined); };

    signal();

    await waitFor(async () => expect(await bound.rpc("decision.list", null)).toHaveLength(1));
    const decision = (await bound.rpc("decision.list", null))[0]!;
    const prompt = await bound.rpc("decision.capture", { id: decision.id });
    const holder = drafts(first.dir);
    const destination = { surface: "decisions", object: prompt.decision, recipient: prompt.agent };
    const a = holder.edit(destination, { ...prompt, choice: "allow", note: "older exact\n" }, null, "ordinary").draft;
    holder.submit(a.revision);
    holder.settle(a.revision, "failed");
    const write = Storage.prototype.setItem;

    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("roundup:drafts:")) throw new Error("disk full");

      write.call(this, key, value);
    });

    const b = holder.edit(destination, { ...prompt, choice: "deny", note: exact }, { start: 2, end: 6, direction: "backward" }, "ordinary").draft;
    calls.forEach((spy) => spy.mockClear());
    mount();
    const recovery = await openRecovery();
    expect(document.querySelector(".decision-card")).toBeNull();

    if (retirement === "answered") await bound.rpc("decision.answer", { id: decision.id, identity: prompt, answer: "deny", proof: PROOF });
    else if (retirement === "dismissed") await bound.rpc("agent.signal", { id: agent.id, attempt: agent.attempt!, payload: { hook_event_name: "Stop" } });
    else signal();

    expect((await bound.rpc("rail.tree", null)).find((node) => node.id === agent.id)?.attempt).toBe(agent.attempt);
    const rowOf = (revision: string) => recovery.querySelector<HTMLElement>(`[data-revision="${revision}"]`)!;
    await waitFor(() => expect(within(rowOf(b.revision)).getByRole("img", { name: "original removed" })).toBeTruthy());
    expect(holder.list()).toEqual([expect.objectContaining({ ...a, status: "failed" }), b]);
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fireEvent.click(within(rowOf(b.revision)).getByRole("button", { name: "Copy" }));
    expect(clipboard).toHaveBeenCalledWith(exact);
    writes.mockRestore();
    fireEvent.click(within(rowOf(a.revision)).getByRole("button", { name: "Discard" }));
    expect(createProjectDrafts()(first.dir).list()).toEqual([b]);
    cleanup();
    drafts = createProjectDrafts();
    mount();
    const restarted = await openRecovery();
    expect(restarted.querySelector(`[data-revision="${b.revision}"]`)).toBeTruthy();
    expect(drafts(first.dir).list()).toEqual([b]);
    expect(calls.flatMap((spy) => spy.mock.calls).filter(([method]) => ["terminal.write", "agent.spawn", "rail.startDoor", "agent.prompt"].includes(method))).toEqual([]);
    expect(calls.flatMap((spy) => spy.mock.calls).filter(([method]) => method === "decision.answer")).toEqual(retirement === "answered" ? [["decision.answer", { id: decision.id, identity: prompt, answer: "deny", proof: PROOF }]] : []);
    const accepted = await bound.rpc("decision.answers", { agent: agent.id });
    expect(accepted).toHaveLength(retirement === "answered" ? 1 : 0);

    if (retirement === "answered") expect(accepted[0]).toMatchObject({ decision, attempt: agent.attempt, answer: "deny", answered_by: { kind: "user", id: "you", parent: null } });

    noDelivery();
  }, 60_000);

  it("u2773d_original_prompt_refuses_replacement_recovery_reused_id_after_restart", async () => {
    await first.restart();
    await setup();
    const bound = app.forProject(first.dir);

    const open = async () => {
      const agent = await bound.rpc("rail.startDoor", { id: original.id });

      void bound.rpc("agent.permission", { id: agent.id, payload: { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "git status" } } }).catch(() => undefined);
      await waitFor(async () => expect(await bound.rpc("decision.list", null)).toHaveLength(1));
      const decision = (await bound.rpc("decision.list", null))[0]!;

      return { decision, prompt: await bound.rpc("decision.capture", { id: decision.id }) };
    };

    const originalPrompt = await open();
    const saved = drafts(first.dir).edit({ surface: "decisions", object: originalPrompt.prompt.decision, recipient: originalPrompt.prompt.agent }, { ...originalPrompt.prompt, choice: "allow", note: exact }, { start: 2, end: 6, direction: "backward" }, "ordinary").draft;
    mount();
    await screen.findByRole("region", { name: "Rail" });
    cleanup();
    await first.restart();
    const replacementPrompt = await open();
    expect(replacementPrompt.decision).toMatchObject({ id: originalPrompt.decision.id, agent: originalPrompt.decision.agent, tool: originalPrompt.decision.tool, args: originalPrompt.decision.args });
    expect(replacementPrompt.prompt.daemon).not.toBe(originalPrompt.prompt.daemon);
    calls.forEach((spy) => spy.mockClear());
    mount();
    const restarted = await openRecovery();
    expect(restarted.querySelector(`[data-revision="${saved.revision}"]`)).toBeTruthy();
    expect(drafts(first.dir).list()).toEqual([saved]);
    expect(await bound.rpc("decision.answers", { agent: replacementPrompt.prompt.agent })).toEqual([]);
    expect(calls.flatMap((spy) => spy.mock.calls).filter(([method]) => ["decision.answer", "terminal.write", "agent.spawn", "rail.startDoor", "agent.prompt"].includes(method))).toEqual([]);
  }, 60_000);

  it.each(["list", "capture"] as const)("u2773h_shared_authority_survives_project_lifecycle_decision_%s_failure", async (read) => {
    await setup();
    const bound = app.forProject(first.dir);
    const agent = await bound.rpc("rail.startDoor", { id: original.id });

    void bound.rpc("agent.permission", { id: agent.id, payload: { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "git status" } } }).catch(() => undefined);
    await waitFor(async () => expect(await bound.rpc("decision.list", null)).toHaveLength(1));
    const decision = (await bound.rpc("decision.list", null))[0]!;
    const prompt = await bound.rpc("decision.capture", { id: decision.id });
    const destination = { surface: "decisions", object: prompt.decision, recipient: prompt.agent };
    const holder = drafts(first.dir);
    const a = holder.edit(destination, { ...prompt, choice: "allow", note: "older" }, null, "ordinary").draft;
    holder.submit(a.revision);
    const b = holder.edit(destination, { ...prompt, choice: "deny", note: exact }, { start: 2, end: 6, direction: "backward" }, "ordinary").draft;
    const separate = drafts(second.dir).edit(destination, { ...prompt, choice: "allow", note: "other Project" }, null, "ordinary").draft;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let finished!: () => void;
    const completed = new Promise<void>((resolve) => { finished = resolve; });
    let phase = "failure";
    const rpc = bound.rpc;

    const authorityRead: AppSeam["rpc"] = async (method, params) => {
      if (method === `decision.${read}`) {
        if (phase === "failure") throw new Error("authority unavailable");

        await pending;
      }

      const result = await rpc(method, params);

      if (method === `decision.${read}`) finished();

      return result;
    };

    bound.rpc = authorityRead;
    const oldCalls = vi.spyOn(bound, "rpc");
    calls.push(oldCalls);
    calls.forEach((spy) => spy.mockClear());
    mount();
    await screen.findByRole("region", { name: "Rail" });
    await waitFor(() => expect(oldCalls.mock.calls.some(([method]) => method === `decision.${read}`)).toBe(true));
    expect(holder.list()).toEqual([expect.objectContaining({ ...a, status: "pending" }), b]);
    cleanup();
    const oldReads = [...oldCalls.mock.calls];
    const previous = app.forProject;
    const current = { ...bound, rpc: authorityRead };
    calls.push(vi.spyOn(current, "rpc"));
    app.forProject = (path) => path === first.dir ? current : previous(path);
    phase = "pending";
    mount();
    await screen.findByRole("region", { name: "Rail" });
    holder.settle(a.revision, "failed");
    await openRecovery();
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    const otherRecovery = await openRecovery();
    const otherCopy = within(otherRecovery.querySelector<HTMLElement>(`[data-revision="${separate.revision}"]`)!).getByRole("button", { name: "Copy" });
    otherCopy.focus();
    release();
    await completed;
    expect(document.activeElement).toBe(otherCopy);
    expect(holder.list()).toEqual([expect.objectContaining({ ...a, status: "failed" }), b]);
    fireEvent.click(screen.getByRole("tab", { name: /^first\b/ }));
    const recovery = await openRecovery();
    expect(recovery.querySelector(`[data-revision="${a.revision}"]`)).toBeTruthy();
    expect(drafts(second.dir).list()).toEqual([separate]);

    expect(oldCalls.mock.calls).toEqual(oldReads);

    expect(calls.flatMap((spy) => spy.mock.calls).filter(([method]) => ["decision.answer", "terminal.write", "agent.spawn", "rail.startDoor", "agent.prompt"].includes(method))).toEqual([]);
  }, 60_000);

  it("u2773h_unavailable_original_remains_recoverable", async () => {
    await setup();
    const holder = drafts(first.dir);
    const a = holder.edit(target(), { ask: "older exact\n" }, null, "ordinary").draft;
    holder.submit(a.revision);
    holder.settle(a.revision, "failed");
    const b = holder.edit(target(), { ask: exact }, null, "ordinary").draft;
    mount();
    await screen.findByRole("button", { name: "Recover unfinished work" });
    await app.forProject(first.dir).rpc("rail.remove", { id: original.id });
    const recovery = await openRecovery();
    const rowOf = (revision: string) => recovery.querySelector<HTMLElement>(`[data-revision="${revision}"]`)!;
    await waitFor(() => expect(rowOf(b.revision)).toBeTruthy());
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fireEvent.click(within(rowOf(b.revision)).getByRole("button", { name: "Copy" }));
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

  it("u2773a_terminal_selection_restores_exact_work", async () => {
    await setup();
    const source = await app.forProject(first.dir).rpc("rail.startDoor", { id: original.id });
    const other = await app.forProject(second.dir).rpc("rail.startDoor", { id: otherOriginal.id });
    expect(other.id).not.toBe(source.id);
    expect(other.name).toBe(source.name);
    const emulators = fakeEmulators();
    const mounted = mount(emulators);
    await screen.findByRole("region", { name: "Rail" });
    await waitFor(() => expect(document.querySelector(`.rail-row[data-id="${source.id}"]`)).toBeTruthy());
    fireEvent.click(document.querySelector(`.rail-row[data-id="${source.id}"]`)!);
    await waitFor(() => expect(emulators.made.has(source.terminal_id!)).toBe(true));
    emulators.made.get(source.terminal_id!)!.select("  source A é\n🧭  ", { command: "echo A", cwd: first.dir, exit: 0 });
    const screenElement = document.querySelector<HTMLElement>("[data-terminal]")!;
    screenElement.focus();
    fireEvent.keyDown(screenElement, { key: "a", code: "KeyA", metaKey: true, shiftKey: true });
    expect(drafts(first.dir).list().filter((draft) => draft.destination.surface === "terminal_selection")).toEqual([]);
    const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Add a note (optional)" });
    fireEvent.input(input, { target: { value: "  note A é 🧭  " } });
    input.setSelectionRange(2, 8, "backward");
    fireEvent.select(input);
    const saved = drafts(first.dir).list().find((draft) => draft.destination.surface === "terminal_selection")!;
    expect(saved.selection).toEqual({ start: 2, end: 8, direction: "backward" });
    calls.forEach((spy) => spy.mockClear());
    fireEvent.click(document.querySelector(`.rail-row[data-id="${replacement.id}"]`)!);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Add a note (optional)" })).toBeNull());
    fireEvent.click(document.querySelector(`.rail-row[data-id="${source.id}"]`)!);
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Add a note (optional)" }).value).toBe("  note A é 🧭  "));
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    await waitFor(() => expect(document.querySelector(`.rail-row[data-id="${other.id}"]`)).toBeTruthy());
    fireEvent.click(document.querySelector(`.rail-row[data-id="${other.id}"]`)!);
    await waitFor(() => expect(emulators.made.has(other.terminal_id!)).toBe(true));
    emulators.made.get(other.terminal_id!)!.select("  source B 🧭\n  ");
    fireEvent.input(await screen.findByRole("textbox", { name: "Add a note (optional)" }), { target: { value: "  note B 🧭  " } });
    const separate = drafts(second.dir).list().find((draft) => draft.destination.surface === "terminal_selection")!;
    expect(separate.value).toMatchObject({ note: "  note B 🧭  ", excerpt: "  source B 🧭\n  ", source: other.id, terminal: other.terminal_id });
    expect(separate.destination.recipient).toBe(other.id);
    fireEvent.click(screen.getByRole("tab", { name: /^first(?: |$)/ }));
    await waitFor(() => expect(document.querySelector<HTMLInputElement>(".send-to-agent-note")?.value).toBe("  note A é 🧭  "));
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Add a note (optional)" }).value).toBe("  note A é 🧭  "));
    await app.forProject(first.dir).rpc("rail.rename", { id: source.id, name: "incoming rename" });
    await waitFor(() => expect(document.querySelector(`.rail-row[data-id="${source.id}"]`)?.textContent).toContain("incoming rename"));
    mounted.unmount();
    drafts = createProjectDrafts();
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    mount();
    const restored = await screen.findByRole<HTMLInputElement>("textbox", { name: "Add a note (optional)" });
    expect(restored.value).toBe("  note A é 🧭  ");
    expect(document.activeElement).toBe(outside);
    expect(drafts(first.dir).list().find((draft) => draft.revision === saved.revision)).toEqual(saved);
    expect(saved.value).toMatchObject({ note: "  note A é 🧭  ", excerpt: "  source A é\n🧭  ", source: source.id, terminal: source.terminal_id, command: "echo A", cwd: first.dir, exit: 0 });
    expect(saved.destination.recipient).toBe(source.id);
    expect(drafts(second.dir).list()).toContainEqual(separate);
    const terminal = document.querySelector<HTMLElement>("[data-terminal]")!;
    terminal.focus();
    fireEvent.keyDown(terminal, { key: "a", code: "KeyA", metaKey: true, shiftKey: true });
    await waitFor(() => expect(document.activeElement).toBe(restored));
    expect([restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([2, 8, "backward"]);
    noDelivery();
    outside.remove();
  }, 60_000);

  it.each(["acknowledged", "failed", "unknown"] as const)("u2773b_terminal_selection_settlement_preserves_other_revisions_%s", async (outcome) => {
    await setup();
    const bound = app.forProject(first.dir);
    const source = await bound.rpc("rail.startDoor", { id: original.id });
    const transport = createServedApp(first.base);
    let complete!: () => void;
    const reply = new Promise<void>((resolve) => { complete = resolve; });

    const delayed: AppSeam["rpc"] = async (method, params) => {
      if (method !== "message.send") return transport.rpc(method, params);
      await reply;

      if (outcome === "failed") throw new RpcError(-32003, "refused");
      const accepted = await transport.rpc(method, params);

      if (outcome === "unknown") throw new RpcError(-32603, "reply lost after acceptance");

      return accepted;
    };

    vi.spyOn(bound, "rpc").mockImplementation(delayed);
    const emulators = fakeEmulators();
    mount(emulators);
    await screen.findByRole("region", { name: "Rail" });
    await waitFor(() => expect(document.querySelector(`.rail-row[data-id="${source.id}"]`)).toBeTruthy());
    fireEvent.click(document.querySelector(`.rail-row[data-id="${source.id}"]`)!);
    await waitFor(() => expect(emulators.made.has(source.terminal_id!)).toBe(true));
    emulators.made.get(source.terminal_id!)!.select(" exact A é\n🧭  ");
    const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Add a note (optional)" });
    fireEvent.input(input, { target: { value: "  note A é  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
    const holder = drafts(first.dir);

    if (!holder.list().some((draft) => draft.status === "pending")) fireEvent.click(await screen.findByRole("menuitem", { name: source.name }));
    await waitFor(() => expect(holder.list().some((draft) => draft.status === "pending")).toBe(true));
    const a = holder.list().find((draft) => draft.status === "pending")!;
    fireEvent.input(input, { target: { value: "  newer B 🧭  " } });
    const b = holder.list().find((draft) => draft.status === "draft")!;
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    complete();
    await waitFor(() => expect(holder.list().find((draft) => draft.revision === a.revision)?.status).toBe(outcome === "acknowledged" ? undefined : outcome));
    expect(document.activeElement).toBe(outside);
    expect(holder.list()).toContainEqual(b);
    fireEvent.click(screen.getByRole("tab", { name: /^first(?: |$)/ }));
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Add a note (optional)" }).value).toBe("  newer B 🧭  "));

    if (outcome === "acknowledged") expect(screen.queryByRole("button", { name: "Recover unfinished work" })).toBeNull();
    else {
      const row = (await openRecovery()).querySelector<HTMLElement>(`[data-revision="${a.revision}"]`)!;

      expect(holder.list()).toContainEqual(b);
      expect(within(row).getByRole("img", { name: outcome === "unknown" ? "may not have saved" : "failed to save" })).toBeTruthy();
      fireEvent.click(within(row).getByRole("button", { name: "Discard" }));
      expect(createProjectDrafts()(first.dir).list()).toEqual([b]);
    }

    const accepted = await transport.rpc("message.list", { to: source.id, status: null });
    expect(accepted.map((message) => message.body)).toEqual(outcome === "failed" ? [] : ["note A é\n\n```\n exact A é\n🧭\n```"]);
    expect(calls.flatMap((spy) => spy.mock.calls).filter(([method]) => method === "message.send")).toHaveLength(1);
    expect(b.destination.recipient).toBe(source.id);
    expect(b.value).toMatchObject({ note: "  newer B 🧭  ", excerpt: " exact A é\n🧭  ", source: source.id, terminal: source.terminal_id, attempt: source.attempt });
    outside.remove();
  }, 60_000);

  it("u2773b_terminal_selection_acknowledgement_consumes_restored_pending_revision", async () => {
    await setup();
    const bound = app.forProject(first.dir);
    const source = await bound.rpc("rail.startDoor", { id: original.id });
    const transport = createServedApp(first.base);
    let complete!: () => void;
    const reply = new Promise<void>((resolve) => { complete = resolve; });

    const delayed: AppSeam["rpc"] = async (method, params) => {
      if (method === "message.send") await reply;

      return transport.rpc(method, params);
    };

    vi.spyOn(bound, "rpc").mockImplementation(delayed);
    const emulators = fakeEmulators();
    const mounted = mount(emulators);
    await screen.findByRole("region", { name: "Rail" });
    await waitFor(() => expect(document.querySelector(`.rail-row[data-id="${source.id}"]`)).toBeTruthy());
    fireEvent.click(document.querySelector(`.rail-row[data-id="${source.id}"]`)!);
    await waitFor(() => expect(emulators.made.has(source.terminal_id!)).toBe(true));
    emulators.made.get(source.terminal_id!)!.select("captured A");
    fireEvent.input(await screen.findByRole("textbox", { name: "Add a note (optional)" }), { target: { value: " pending A " } });
    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
    expect(drafts(first.dir).list().map((draft) => draft.status)).toEqual(["pending"]);
    mounted.unmount();
    mount();
    expect((await screen.findByRole<HTMLInputElement>("textbox", { name: "Add a note (optional)" })).value).toBe(" pending A ");
    complete();
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Add a note (optional)" })).toBeNull());
    expect(drafts(first.dir).list()).toEqual([]);
    expect(createProjectDrafts()(first.dir).list()).toEqual([]);
    expect((await transport.rpc("message.list", { to: source.id, status: null })).map((message) => message.body)).toEqual(["pending A\n\n```\ncaptured A\n```"]);
    expect(calls.flatMap((spy) => spy.mock.calls).filter(([method]) => method === "message.send")).toHaveLength(1);
  }, 60_000);

  it("u2773b_terminal_selection_out_of_order_replies_settle_their_own_revision", async () => {
    await setup();
    const bound = app.forProject(first.dir);
    const source = await bound.rpc("rail.startDoor", { id: original.id });
    const transport = createServedApp(first.base);
    const completions: (() => void)[] = [];

    const delayed: AppSeam["rpc"] = async (method, params) => {
      if (method !== "message.send") return transport.rpc(method, params);
      const index = completions.length;
      await new Promise<void>((resolve) => { completions.push(resolve); });

      if (index === 0) throw new RpcError(-32003, "older refusal");

      return transport.rpc(method, params);
    };

    vi.spyOn(bound, "rpc").mockImplementation(delayed);
    const emulators = fakeEmulators();
    mount(emulators);
    await screen.findByRole("region", { name: "Rail" });
    await waitFor(() => expect(document.querySelector(`.rail-row[data-id="${source.id}"]`)).toBeTruthy());
    fireEvent.click(document.querySelector(`.rail-row[data-id="${source.id}"]`)!);
    await waitFor(() => expect(emulators.made.has(source.terminal_id!)).toBe(true));
    emulators.made.get(source.terminal_id!)!.select(" original excerpt 🧭 ");
    const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Add a note (optional)" });
    fireEvent.input(input, { target: { value: " A é " } });
    emulators.made.get(source.terminal_id!)!.select(" original excerpt 🧭 ", { command: "later live command", cwd: "/other", exit: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
    const holder = drafts(first.dir);
    const a = holder.list().find((draft) => draft.status === "pending")!;
    fireEvent.input(input, { target: { value: " B 🧭 " } });
    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
    const b = holder.list().find((draft) => draft.status === "pending" && draft.revision !== a.revision)!;
    expect(b).toBeDefined();
    fireEvent.input(input, { target: { value: " C é 🧭 " } });
    const c = holder.list().find((draft) => draft.status === "draft")!;
    completions[1]!();
    await waitFor(() => expect(holder.list().some((draft) => draft.revision === b.revision)).toBe(false));
    completions[0]!();
    await waitFor(() => expect(holder.list().find((draft) => draft.revision === a.revision)?.status).toBe("failed"));
    expect(holder.list()).toEqual([{ ...a, status: "failed" }, c]);
    expect(input.value).toBe(" C é 🧭 ");
    expect((await transport.rpc("message.list", { to: source.id, status: null })).map((message) => message.body)).toEqual(["B 🧭\n\n```\n original excerpt 🧭\n```"]);
    expect(calls.flatMap((spy) => spy.mock.calls).filter(([method]) => method === "message.send")).toHaveLength(2);
  }, 60_000);

  it("u2773e_recovery_actions_keep_surface_draft_terminal_selection", async () => {
    await setup();
    const source = await app.forProject(first.dir).rpc("rail.startDoor", { id: original.id });
    const emulators = fakeEmulators();
    mount(emulators);
    await screen.findByRole("region", { name: "Rail" });
    await waitFor(() => expect(document.querySelector(`.rail-row[data-id="${source.id}"]`)).toBeTruthy());
    fireEvent.click(document.querySelector(`.rail-row[data-id="${source.id}"]`)!);
    await waitFor(() => expect(emulators.made.has(source.terminal_id!)).toBe(true));
    const emulator = emulators.made.get(source.terminal_id!)!;
    emulator.select("  original excerpt\n🧭  ");
    fireEvent.input(await screen.findByRole("textbox", { name: "Add a note (optional)" }), { target: { value: " older A " } });
    const holder = drafts(first.dir);
    const a = holder.list().find((draft) => draft.destination.surface === "terminal_selection")!;
    const before = window.localStorage.getItem(`roundup:drafts:${first.dir}`);
    const write = Storage.prototype.setItem;


    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("roundup:drafts:")) throw new Error("disk full");
      write.call(this, key, value);
    });

    emulator.select("  separate B é\n🧭  ");
    fireEvent.input(await screen.findByRole("textbox", { name: "Add a note (optional)" }), { target: { value: "  newer B 🧭  " } });
    const b = holder.list().find((draft) => draft.revision !== a.revision)!;
    expect(holder.list()).toContainEqual(a);
    expect(b.value).toMatchObject({ note: "  newer B 🧭  ", excerpt: "  separate B é\n🧭  ", source: source.id, terminal: source.terminal_id });
    expect(b.destination.recipient).toBe(source.id);
    expect(window.localStorage.getItem(`roundup:drafts:${first.dir}`)).toBe(before);
    expect(await screen.findByRole("alert")).toBeTruthy();
    const recovery = await openRecovery();
    const rowOf = (revision: string) => recovery.querySelector<HTMLElement>(`[data-revision="${revision}"]`)!;
    fireEvent.click(within(rowOf(b.revision)).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Unfinished work" })).toBeNull());
    writes.mockRestore();
    fireEvent.click(await screen.findByRole("button", { name: "Discard note" }));
    expect(createProjectDrafts()(first.dir).list()).toEqual([a]);
    expect((await screen.findByRole<HTMLInputElement>("textbox", { name: "Add a note (optional)" })).value).toBe(" older A ");
    noDelivery();
  }, 60_000);

  it.each([
    { ending: "exit", observer: "u2773a_terminal_selection_restores_exact_work_shared_exit" },
    { ending: "remove", observer: "u2773e_recovery_actions_keep_surface_draft_terminal_selection_shared_remove" },
  ] as const)("$observer", async ({ ending }) => {
    await setup();
    const bound = app.forProject(first.dir);
    const source = await bound.rpc("rail.startDoor", { id: original.id });
    const terminal = source.terminal_id!;
    await bound.rpc("rail.rename", { id: replacement.id, name: source.name });
    const liveReplacement = await bound.rpc("rail.startDoor", { id: replacement.id });
    const holder = drafts(first.dir);
    const destination = { surface: "terminal_selection", object: terminal, recipient: source.id };
    const a = holder.edit(destination, { note: "older exact\n", excerpt: exact, source: source.id, attempt: source.attempt, terminal: source.terminal_id!, command: null, cwd: null, exit: null, x: 120, y: 80 }, null, "ordinary").draft;
    holder.submit(a.revision);
    const status = ending === "exit" ? "failed" : "unknown";

    holder.settle(a.revision, status);
    const write = Storage.prototype.setItem;


    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("roundup:drafts:")) throw new Error("disk full");

      write.call(this, key, value);
    });

    const b = holder.edit(destination, { note: exact, excerpt: " captured 🧭\n", source: source.id, attempt: source.attempt, terminal: source.terminal_id!, command: null, cwd: null, exit: null, x: 120, y: 80 }, { start: 2, end: 5, direction: "backward" }, "ordinary").draft;
    mount();
    await screen.findByRole("region", { name: "Rail" });
    await waitFor(() => expect(document.querySelector(`.rail-row[data-id="${source.id}"]`)).toBeTruthy());
    fireEvent.click(document.querySelector(`.rail-row[data-id="${source.id}"]`)!);
    await waitFor(() => expect(document.querySelector(`[data-terminal="${terminal}"]`)).toBeTruthy());
    fireEvent.click(document.querySelector(`.rail-row[data-id="${liveReplacement.id}"]`)!);
    await waitFor(() => expect(document.querySelector(`[data-terminal="${terminal}"]`)).toBeNull());
    const recovery = await openRecovery();
    const rowOf = (revision: string) => recovery.querySelector<HTMLElement>(`[data-revision="${revision}"]`)!;
    expect(within(rowOf(a.revision)).getByRole("img", { name: status === "failed" ? "failed to save" : "may not have saved" })).toBeTruthy();
    writes.mockRestore();
    calls.forEach((spy) => spy.mockClear());

    if (ending === "exit") await bound.rpc("terminal.kill", { id: terminal });
    else await bound.rpc("rail.remove", { id: source.id });
    await waitFor(() => expect(within(rowOf(a.revision)).getByRole("button", { name: "Copy" })).toBeTruthy());
    expect(holder.list()).toEqual([expect.objectContaining({ revision: a.revision, status }), b]);
    const tree = await bound.rpc("rail.tree", null);
    expect(tree.some((node) => node.id === source.id)).toBe(ending === "exit");
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    fireEvent.click(screen.getByRole("tab", { name: /^first(?: |$)/ }));
    const reopened = await openRecovery();
    const copyRow = within(reopened.querySelector<HTMLElement>(`[data-revision="${a.revision}"]`)!);
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fireEvent.click(copyRow.getByRole("button", { name: "Copy" }));
    expect(clipboard).toHaveBeenCalledWith("older exact\n");
    fireEvent.click(copyRow.getByRole("button", { name: "Discard" }));
    expect(createProjectDrafts()(first.dir).list()).toEqual([b]);
    expect((await bound.rpc("rail.tree", null)).find((node) => node.id === liveReplacement.id)).toMatchObject({ id: liveReplacement.id, name: source.name, terminal_id: liveReplacement.terminal_id });
    expect((await bound.rpc("terminal.list", null)).find((each) => each.id === liveReplacement.terminal_id)?.running).toBe(true);
    const methods = calls.flatMap((spy) => spy.mock.calls.map(([method]) => method));
    expect(methods.filter((method) => method === "terminal.write" || method === "terminal.spawn" || method === "rail.startDoor")).toEqual([]);
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
    initial.made.get(terminal)!.select(" captured source\n");
    fireEvent.input(await screen.findByRole("textbox", { name: "Add a note (optional)" }), { target: { value: " retained 🧭  " } });
    const saved = drafts(first.dir).list().find((draft) => draft.destination.surface === "terminal_selection")!;
    expect(saved.value).toMatchObject({ note: " retained 🧭  ", excerpt: " captured source\n", source: source.id, terminal, attempt: source.attempt });
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
    await screen.findByRole("button", { name: "Recover unfinished work" });
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


  it("u2773a_terminal_selection_restores_exact_work_shared_reused_terminal_id", async () => {
    await setup();
    await first.restart();
    const bound = app.forProject(first.dir);
    const source = await bound.rpc("rail.startDoor", { id: original.id });
    const saved = drafts(first.dir).edit({ surface: "terminal_selection", object: source.terminal_id!, recipient: source.id }, { note: exact, excerpt: "", source: source.id, attempt: source.attempt, terminal: source.terminal_id!, command: null, cwd: null, exit: null, x: 120, y: 80 }, null, "ordinary").draft;
    await first.restart();
    await bound.rpc("rail.rename", { id: replacement.id, name: source.name });
    const liveReplacement = await bound.rpc("rail.startDoor", { id: replacement.id });
    expect(liveReplacement.terminal_id).toBe(source.terminal_id);
    calls.forEach((spy) => spy.mockClear());
    mount();
    const recovery = await openRecovery();
    expect(recovery.querySelector(`[data-revision="${saved.revision}"]`)).toBeTruthy();
    expect(drafts(first.dir).list()).toEqual([saved]);
    expect((await bound.rpc("terminal.list", null)).find((each) => each.id === liveReplacement.terminal_id)?.running).toBe(true);
    noDelivery();
  }, 60_000);

});

// The fake vendor's child uses the public CLI, with the Agent environment supplied by its launcher.
// No test impersonates that Actor at the App seam or parses a vendor editor.
describe("u2773 unfinished Decision forms on real Projects", () => {
  let first: StartedDaemon;
  let second: StartedDaemon;
  let app: AppSeam;
  let drafts: ReturnType<typeof createProjectDrafts>;
  let agents: RailNode[];
  let calls: MockInstance<AppSeam["rpc"]>[];
  const exact = "  first é\nsecond 👩🏽‍💻  ";
  const choice = [{ label: "A", description: "first" }, { label: "B", description: "second" }];
  const field = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Note" });
  const mount = () => render(() => <App app={app} drafts={drafts} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);

  const selectAgent = async (agent: RailNode) => {
    fireEvent.click(await screen.findByRole("treeitem", { name: new RegExp(agent.name) }));

    return screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Note" });
  };

  const openRecovery = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));

    return screen.findByRole("region", { name: "Unfinished work" });
  };

  beforeAll(async () => {
    const env = { FAKE_CLAUDE_DOOR_PROCESS: JSON.stringify(["rup", "--json", "agent", "ask", "Same question?", ...choice.flatMap(answer => ["--answers", JSON.stringify(answer)])]) };
    first = await startRealDaemon(env);
    second = await startRealDaemon(env);
  }, 240_000);
  afterAll(async () => {
    await first?.stop();
    await second?.stop();

  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

  const setup = async () => {
    cleanup();
    localStorage.clear();
    drafts = createProjectDrafts();
    const roots = [first, second];
    const connections = roots.map(root => createServedApp(root.base));
    agents = [];

    for (const bound of connections) {
      for (const node of await bound.rpc("rail.tree", null)) {
        if (node.kind === "workstream" && node.parent === null) await bound.rpc("rail.remove", { id: node.id });
      }

      if (agents.length > 0) {
        const spacer = await bound.rpc("rail.createWorkstream", { name: "spacer", parent: null });
        await bound.rpc("rail.remove", { id: spacer.id });
      }

      const workstream = await bound.rpc("rail.createWorkstream", { name: "same name", parent: null });
      agents.push(await bound.rpc("rail.startDoor", { id: workstream.id }));
      await waitFor(async () => expect(await bound.rpc("decision.list", null)).toHaveLength(1));
    }

    let opened = [first.dir];
    const closed = new Set<string>();
    app = {
      ...connections[0]!,
      projects: async () => opened.map(path => ({ path, name: path === first.dir ? "first" : "second", running: true })),
      forProject: path => connections[path === first.dir ? 0 : 1]!,
      chooseProjectPath: async () => second.dir,
      closeProject: async path => {
        roots.find(root => root.dir === path)!.daemon.kill();
        closed.add(path);
        opened = opened.filter(open => open !== path);
      },
      openProject: async path => {
        if (closed.delete(path)) {
          const index = path === first.dir ? 0 : 1;
          await roots[index]!.restart();
          connections[index] = createServedApp(roots[index]!.base);
          calls.push(vi.spyOn(connections[index]!, "rpc"));
        }

        if (!opened.includes(path)) opened.push(path);

        return { path, name: path === first.dir ? "first" : "second" };
      },
      onDaemonExited: async () => () => {},
    };
    calls = connections.map(bound => vi.spyOn(bound, "rpc"));
  };

  it("u2773a_decisions_restores_exact_work_real_projects", async () => {
    await setup();
    mount();
    await selectAgent(agents[0]!);
    const original = await app.forProject(first.dir).rpc("decision.capture", { id: (await app.forProject(first.dir).rpc("decision.list", null))[0]!.id });
    fireEvent.click(screen.getByRole("option", { name: "B" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "B" }).getAttribute("aria-selected")).toBe("true"));
    fireEvent.input(field(), { target: { value: exact } });
    field().focus();
    field().setSelectionRange(2, 7, "backward");
    fireEvent.select(field());
    const saved = drafts(first.dir).list()[0]!;
    expect(saved.value).toEqual({ ...original, choice: "B", note: exact });
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: /^second\b/ });
    await selectAgent(agents[1]!);
    expect(field().value).toBe("");
    fireEvent.input(field(), { target: { value: "  other Project\n🌿 " } });
    const other = drafts(second.dir).list()[0]!;
    expect(other.value.agent).toBe(agents[1]!.id);
    expect(other.value.daemon).not.toBe(original.daemon);
    const outside = screen.getByRole("tab", { name: /^first\b/ });
    outside.focus();
    fireEvent.click(outside);
    await waitFor(() => expect(field().value).toBe(exact));
    // Explicit Project selection keeps its Terminal focus contract; a later background Event must not move it.
    const focus = document.activeElement;
    await app.forProject(first.dir).rpc("rail.rename", { id: agents[0]!.id, name: "renamed original" });
    await screen.findByRole("treeitem", { name: /renamed original/ });
    await screen.findByRole("textbox", { name: "Note" });
    expect(document.activeElement).toBe(focus);
    expect([field().selectionStart, field().selectionEnd, field().selectionDirection]).toEqual([2, 7, "backward"]);
    cleanup();
    drafts = createProjectDrafts();
    mount();
    await selectAgent({ ...agents[0]!, name: "renamed original" });
    expect(field().value).toBe(exact);
    expect(drafts(first.dir).list()).toEqual([saved]);
    expect(drafts(second.dir).list()).toEqual([other]);
    fireEvent.pointerEnter(screen.getByRole("tab", { name: /^first\b/ }).closest(".project-tab")!);
    fireEvent.click(screen.getByRole("button", { name: "Close first" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop and close" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(screen.queryByRole("tab", { name: /^first\b/, hidden: true })).toBeNull());
    app.chooseProjectPath = async () => first.dir;
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: /^first\b/ });
    const recovery = await openRecovery();
    expect(recovery.querySelector(`[data-revision="${saved.revision}"]`)).toBeTruthy();
    expect(drafts(first.dir).list()).toEqual([saved]);
    expect(drafts(second.dir).list()).toEqual([other]);
    expect(calls.flatMap(spy => spy.mock.calls).filter(([method]) => ["decision.answer", "terminal.write", "agent.prompt"].includes(method))).toEqual([]);
  }, 60_000);

  it.each(["failed", "unknown", "acknowledged"] as const)("u2773b_decisions_settlement_preserves_other_revisions_real_%s", async outcome => {
    await setup();
    const bound = app.forProject(first.dir);
    const transport = bound.rpc;
    let release!: () => void;
    const reply = new Promise<void>(resolve => { release = resolve; });
    bound.rpc = async (method, params) => {
      if (method !== "decision.answer") return transport(method, params);
      await reply;

      if (outcome === "failed") throw new RpcError(-32602, "refused before delivery");
      const result = await transport(method, params);

      if (outcome === "unknown") throw new RpcError(-32004, "reply lost after acceptance");

      return result;
    };

    const answerCalls = vi.spyOn(bound, "rpc");
    mount();
    await selectAgent(agents[0]!);
    fireEvent.input(field(), { target: { value: exact } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(answerCalls.mock.calls.filter(([method]) => method === "decision.answer")).toHaveLength(1));
    fireEvent.input(field(), { target: { value: "  newer B\né 🧭  " } });
    const [a, b] = drafts(first.dir).list();
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: /^second\b/ });
    release();
    await waitFor(() => expect(drafts(first.dir).list().some(draft => draft.status === "pending")).toBe(false));
    expect(drafts(first.dir).list()).toEqual(outcome === "acknowledged" ? [b] : [{ ...a, status: outcome }, b]);
    const accepted = await transport("decision.answers", { agent: agents[0]!.id });
    expect(accepted).toHaveLength(outcome === "failed" ? 0 : 1);

    if (outcome !== "failed") expect(accepted[0]).toMatchObject({ answer: "A", note: exact, attempt: agents[0]!.attempt, answered_by: { kind: "user", id: "you", parent: null } });
    expect(answerCalls.mock.calls.filter(([method]) => method === "decision.answer")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: /^first\b/ }));

    if (outcome === "acknowledged") expect(screen.queryByRole("button", { name: "Recover unfinished work" })).toBeNull();
    else {
      const recovery = await openRecovery();

      expect(within(recovery.querySelector<HTMLElement>(`[data-revision="${a!.revision}"]`)!).getByRole("img", { name: outcome === "unknown" ? /may not have saved|original removed/ : "failed to save" })).toBeTruthy();
    }

    expect(drafts(first.dir).list()).toContainEqual(b);
    expect(calls.flatMap(spy => spy.mock.calls).filter(([method]) => method === "terminal.write")).toEqual([]);
  }, 60_000);
  it.each(["answered", "dismissed", "attempt", "restart"] as const)("u2773d_original_prompt_refuses_replacement_form_%s", async retirement => {
    await setup();
    mount();
    await selectAgent(agents[0]!);
    const bound = app.forProject(first.dir);
    const decision = (await bound.rpc("decision.list", null))[0]!;
    const identity = await bound.rpc("decision.capture", { id: decision.id });
    fireEvent.click(screen.getByRole("option", { name: "B" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "B" }).getAttribute("aria-selected")).toBe("true"));
    fireEvent.input(field(), { target: { value: exact } });
    const saved = drafts(first.dir).list()[0]!;
    expect(saved.value).toEqual({ ...identity, choice: "B", note: exact });
    cleanup();

    if (retirement === "answered") await bound.rpc("decision.answer", { id: decision.id, identity, answer: "A", proof: PROOF });
    else if (retirement === "dismissed") await bound.rpc("agent.signal", { id: agents[0]!.id, attempt: agents[0]!.attempt!, payload: { hook_event_name: "Stop" } });
    else if (retirement === "attempt") {
      const id = agents[0]!.id;
      const session = "00000000-0000-4000-8000-000000002773";
      await bound.rpc("agent.signal", { id, attempt: agents[0]!.attempt!, payload: { hook_event_name: "SessionStart", session_id: session, source: "startup" } });
      const resuming = bound.rpc("agent.resume", { id, mode: "normal" });
      await waitFor(async () => expect((await bound.rpc("terminal.list", null)).some(terminal => terminal.id !== agents[0]!.terminal_id && terminal.running)).toBe(true));
      const next = (await bound.rpc("rail.tree", null)).find(node => node.id === id)!;
      await bound.rpc("agent.signal", { id, attempt: next.attempt!, payload: { hook_event_name: "SessionStart", session_id: session, source: "resume" } });
      expect(await resuming).toMatchObject({ id, attempt: next.attempt });
      expect(next.attempt).not.toBe(agents[0]!.attempt);
    }
    else {
      await first.restart();
      const current = createServedApp(first.base);
      const previous = app.forProject;
      app.forProject = path => path === first.dir ? current : previous(path);
      calls.push(vi.spyOn(current, "rpc"));
    }

    const current = app.forProject(first.dir);

    calls.forEach(spy => spy.mockClear());
    drafts = createProjectDrafts();
    mount();
    const recovery = await openRecovery();
    expect(recovery.querySelector(`[data-revision="${saved.revision}"]`)).toBeTruthy();
    expect(drafts(first.dir).list()).toEqual([saved]);
    expect(within(recovery).queryByRole("button", { name: "Send" })).toBeNull();
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fireEvent.click(within(recovery).getByRole("button", { name: "Copy" }));
    expect(clipboard).toHaveBeenCalledWith(exact);
    const target = (await current.rpc("rail.tree", null)).find(node => node.id === agents[0]!.id);
    const live = (await current.rpc("terminal.list", null)).find(terminal => terminal.id === target?.terminal_id && terminal.running);
    const before = live ? await current.rpc("terminal.snapshot", { id: live.id }) : null;
    await expect(current.rpc("decision.answer", { id: decision.id, identity, answer: "B", note: exact, proof: PROOF })).rejects.toBeInstanceOf(RpcError);

    if (live) expect((await current.rpc("terminal.snapshot", { id: live.id })).after).toBe(before!.after);
    else expect((await current.rpc("terminal.list", null)).some(terminal => terminal.running)).toBe(false);
    const accepted = await current.rpc("decision.answers", { agent: agents[0]!.id });
    expect(accepted).toHaveLength(retirement === "answered" ? 1 : 0);

    if (retirement === "answered") expect(accepted[0]).toMatchObject({ answer: "A", answered_by: { kind: "user", id: "you", parent: null } });
    expect(calls.flatMap(spy => spy.mock.calls).filter(([method]) => method === "terminal.write")).toEqual([]);
    fireEvent.click(within(recovery).getByRole("button", { name: "Discard" }));
    expect(drafts(first.dir).list()).toEqual([]);
  }, 60_000);

});
