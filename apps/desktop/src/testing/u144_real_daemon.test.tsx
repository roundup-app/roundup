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
    const separate = drafts(second.dir).edit({ surface: "pads", object: other.incarnation, recipient: null }, { originalName: other.name, source: "other", base: other.text }, null, "ordinary").draft;
    mount();
    const recovery = await openRecovery();
    await waitFor(() => expect(within(recovery).queryByRole("status")).toBeNull());
    const inspect = screen.getByRole("button", { name: new RegExp(saved.revision) });
    inspect.focus();
    await firstApp.rpc("pad.delete", { name: pad.name });
    const replacementPad = await firstApp.rpc("pad.create", { name: pad.name, text: "replacement" });
    expect(replacementPad.incarnation).not.toBe(pad.incarnation);
    await waitFor(() => expect(within(recovery).getByRole("status").dataset.state).toBe("unavailable"));
    expect(inspect.getAttribute("aria-label")).toContain(` · ${pad.incarnation} · `);
    expect(screen.getByRole("heading", { level: 3, name: new RegExp(pad.name) })).toBeTruthy();
    expect(screen.getByText(exact, { normalizer: (text) => text }).textContent).toBe(exact);
    expect(document.activeElement).toBe(inspect);
    expect(holder.list()).toEqual([saved]);
    expect(screen.getByText(pad.text, { normalizer: (text) => text }).textContent).toBe(pad.text);
    expect(drafts(second.dir).list()).toEqual([separate]);
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    const otherRecovery = await openRecovery();
    await waitFor(() => expect(within(otherRecovery).queryByRole("status")).toBeNull());
    expect(screen.getByRole("button", { name: new RegExp(separate.revision) }).getAttribute("aria-label")).toContain(` · ${other.incarnation} · `);
    expect(screen.queryByRole("button", { name: new RegExp(saved.revision) })).toBeNull();
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
    expect((await screen.findByRole("alert")).textContent).toContain(first.dir);
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(older.revision) }));
    fireEvent.click(screen.getByRole("button", { name: "Copy source" }));
    expect(clipboard).toHaveBeenCalledWith("older\n");
    const inspect = screen.getByRole("button", { name: new RegExp(older.revision) });
    inspect.focus();
    calls.forEach((spy) => spy.mockClear());
    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
    expect(document.activeElement).toBe(inspect);
    expect(holder.list().find((draft) => draft.revision === newer.revision)).toEqual(newer);
    expect(screen.getAllByRole("listitem").filter((row) => row.dataset.current === "true").map((row) => row.dataset.revision)).toEqual([newer.revision]);
    fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
    expect(createProjectDrafts()(first.dir).list()).toEqual([newer]);
    expect(createProjectDrafts()(second.dir).list()).toEqual([separate]);
    expect(calls.flatMap((spy) => spy.mock.calls).filter(([method]) => !["pad.list", "todo.list"].includes(method))).toEqual([]);
  }, 60_000);

  it("u2773h_shared_authority_survives_project_lifecycle", async () => {
    await setup();
    const holder = drafts(first.dir);
    const saved = holder.edit(target(), { title: "same name", ask: exact, done: "  yes\n" }, { start: 2, end: 6, direction: "backward" }, "ordinary").draft;
    const independent = holder.edit({ surface: "todos", object: original.id, recipient: null }, { title: "independent 🧭" }, null, "ordinary").draft;
    drafts(second.dir).edit({ surface: "orders", object: otherOriginal.id, recipient: otherOriginal.id }, { ask: "other Project" }, null, "ordinary");
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
    await openRecovery();
    const revisionButton = screen.getByRole("button", { name: new RegExp(saved.revision) });
    fireEvent.click(revisionButton);
    revisionButton.focus();
    holder.retry();
    expect(document.activeElement).toBe(revisionButton);
    expect(screen.getByText(exact, { normalizer: (text) => text }).textContent).toBe(exact);
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    await openRecovery();
    expect(screen.queryByText(exact, { normalizer: (text) => text })).toBeNull();
    expect(screen.getByText("other Project")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "first" }));
    cleanup();
    drafts = createProjectDrafts();
    mount();
    await openRecovery();
    expect(drafts(first.dir).list()).toEqual([saved, independent]);
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
    expect((await screen.findByRole("alert")).textContent).toContain(first.dir);
    expect(screen.getByRole("alert").textContent).toContain(kind === "surface" ? "Todo" : "Order");
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
    fireEvent.click(screen.getByRole("button", { name: new RegExp(saved.revision) }));
    expect(screen.getByText(exact, { normalizer: (text) => text }).textContent).toBe(exact);

    if (kind === "surface") {
      fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
      expect(localStorage.getItem(key)).toBe(bytes);
      expect(screen.getByRole("alert")).toBeTruthy();
      localStorage.setItem(key, JSON.stringify({ version: 1, drafts: [] }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
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
    await openRecovery();
    expect(screen.getByRole("img", { name: "Pending" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    holder.settle(a.revision, "failed");
    expect(holder.list()).toEqual([expect.objectContaining({ revision: a.revision, status: "failed" }), b]);
    holder.settle(a.revision, "unknown");
    fireEvent.click(screen.getByRole("tab", { name: "first" }));
    await openRecovery();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(a.revision) }));
    expect(holder.list().find((draft) => draft.revision === b.revision)).toEqual(b);
    expect(screen.getByRole("img", { name: "Acceptance unknown" })).toBeTruthy();
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
    await waitFor(() => expect(within(recovery).queryByRole("status")).toBeNull());
    expect(document.querySelector(".decision-card")).toBeNull();

    if (retirement === "answered") await bound.rpc("decision.answer", { id: decision.id, identity: prompt, answer: "deny", proof: PROOF });
    else if (retirement === "dismissed") await bound.rpc("agent.signal", { id: agent.id, attempt: agent.attempt!, payload: { hook_event_name: "Stop" } });
    else signal();

    expect((await bound.rpc("rail.tree", null)).find((node) => node.id === agent.id)?.attempt).toBe(agent.attempt);
    await within(recovery).findByText("Original object unavailable");
    expect(holder.list()).toEqual([expect.objectContaining({ ...a, status: "failed" }), b]);
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fireEvent.click(screen.getByRole("button", { name: "Copy note" }));
    expect(clipboard).toHaveBeenCalledWith(exact);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(a.revision) }));
    const inspect = screen.getByRole("button", { name: new RegExp(a.revision) });
    inspect.focus();
    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
    expect(document.activeElement).toBe(inspect);
    fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
    expect(createProjectDrafts()(first.dir).list()).toEqual([b]);
    cleanup();
    drafts = createProjectDrafts();
    mount();
    await openRecovery();
    await screen.findByText("Original object unavailable");
    expect(drafts(first.dir).list()).toEqual([b]);
    expect(calls.flatMap((spy) => spy.mock.calls).filter(([method]) => ["terminal.write", "agent.spawn", "rail.startDoor", "agent.prompt"].includes(method))).toEqual([]);
    expect(calls.flatMap((spy) => spy.mock.calls).filter(([method]) => method === "decision.answer")).toEqual(retirement === "answered" ? [["decision.answer", { id: decision.id, identity: prompt, answer: "deny", proof: PROOF }]] : []);
    const accepted = await bound.rpc("decision.answers", { agent: agent.id });
    expect(accepted).toHaveLength(retirement === "answered" ? 1 : 0);

    if (retirement === "answered") expect(accepted[0]).toMatchObject({ decision, attempt: agent.attempt, answer: "deny", answered_by: { kind: "user" } });

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
    const recovery = await openRecovery();
    await waitFor(() => expect(within(recovery).queryByRole("status")).toBeNull());
    cleanup();
    await first.restart();
    const replacementPrompt = await open();
    expect(replacementPrompt.decision).toMatchObject({ id: originalPrompt.decision.id, agent: originalPrompt.decision.agent, tool: originalPrompt.decision.tool, args: originalPrompt.decision.args });
    expect(replacementPrompt.prompt.daemon).not.toBe(originalPrompt.prompt.daemon);
    calls.forEach((spy) => spy.mockClear());
    mount();
    await openRecovery();
    await screen.findByText("Original object unavailable");
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

    bound.rpc = async (method, params) => {
      if (method === `decision.${read}`) {
        if (phase === "failure") throw new Error("authority unavailable");

        await pending;
      }

      const result = await rpc(method, params);

      if (method === `decision.${read}`) finished();

      return result;
    };

    calls.push(vi.spyOn(bound, "rpc"));
    calls.forEach((spy) => spy.mockClear());
    mount();
    await openRecovery();
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Unfinished work" })).getByRole("status").dataset.state).toBe("unverified"));
    expect(holder.list()).toEqual([expect.objectContaining({ ...a, status: "pending" }), b]);
    cleanup();
    phase = "pending";
    mount();
    await openRecovery();
    const inspect = screen.getByRole("button", { name: new RegExp(b.revision) });
    inspect.focus();
    expect(within(screen.getByRole("region", { name: "Unfinished work" })).getByRole("status").dataset.state).toBe("unverified");
    holder.settle(a.revision, "failed");
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    await openRecovery();
    await screen.findByText("Original object unavailable");
    const otherInspect = screen.getByRole("button", { name: new RegExp(separate.revision) });
    otherInspect.focus();
    release();
    await completed;
    expect(document.activeElement).toBe(otherInspect);
    expect(holder.list()).toEqual([expect.objectContaining({ ...a, status: "failed" }), b]);
    fireEvent.click(screen.getByRole("tab", { name: /^first\b/ }));
    const recovery = await openRecovery();
    await waitFor(() => expect(within(recovery).queryByRole("status")).toBeNull());
    expect(screen.getByText(exact, { normalizer: (text) => text }).textContent).toBe(exact);
    expect(drafts(second.dir).list()).toEqual([separate]);
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
    await openRecovery();
    expect(await screen.findByText("Original object unavailable")).toBeTruthy();
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fireEvent.click(screen.getByRole("button", { name: "Copy ask" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(exact));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(a.revision) }));
    expect(holder.list().find((draft) => draft.revision === b.revision)).toEqual(b);
    fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
    cleanup();
    drafts = createProjectDrafts();
    mount();
    await openRecovery();
    expect(drafts(first.dir).list()).toEqual([b]);
    expect(screen.queryByRole("button", { name: new RegExp(a.revision) })).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(original.id) })).toBeTruthy();
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
    const recovery = await openRecovery();

    if (outcome !== "acknowledged") {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(a.revision) }));
      expect(holder.list()).toContainEqual(b);
      expect(within(recovery).getByRole("img", { name: outcome === "unknown" ? "Acceptance unknown" : "Failed" })).toBeTruthy();
      fireEvent.click(within(recovery).getByRole("button", { name: "Discard this revision" }));
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
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fireEvent.click(screen.getByRole("button", { name: "Copy note" }));
    expect(clipboard).toHaveBeenLastCalledWith("  newer B 🧭  ");
    fireEvent.click(screen.getByRole("button", { name: "Copy Excerpt" }));
    expect(clipboard).toHaveBeenLastCalledWith("  separate B é\n🧭  ");
    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(createProjectDrafts()(first.dir).list()).toEqual([a, b]);
    fireEvent.click(screen.getByRole("button", { name: "Discard note" }));
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
    await openRecovery();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(a.revision) }));
    const inspect = screen.getByRole("button", { name: new RegExp(a.revision) });
    expect((await screen.findByRole("alert")).textContent).toContain(first.dir);
    writes.mockRestore();
    expect(screen.queryByText("Original object unavailable")).toBeNull();
    expect(screen.queryByText("Original availability not verified")).toBeNull();
    inspect.focus();
    recoverSelections();
    expect(document.activeElement).toBe(inspect);
    calls.forEach((spy) => spy.mockClear());

    if (ending === "exit") await bound.rpc("terminal.kill", { id: terminal });
    else await bound.rpc("rail.remove", { id: source.id });
    await screen.findByText("Original object unavailable");
    expect(document.activeElement).toBe(inspect);
    expect(holder.list()).toEqual([expect.objectContaining({ revision: a.revision, status }), b]);
    expect(screen.getByText(`${terminal} · ${source.id}`)).toBeTruthy();
    expect(screen.getByText(exact, { normalizer: (text) => text }).textContent).toBe(exact);
    const tree = await bound.rpc("rail.tree", null);
    expect(tree.some((node) => node.id === source.id)).toBe(ending === "exit");
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    fireEvent.click(screen.getByRole("tab", { name: /^first(?: |$)/ }));
    await openRecovery();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(a.revision) }));
    expect(screen.getByRole("img", { name: status === "failed" ? "Failed" : "Acceptance unknown" })).toBeTruthy();
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fireEvent.click(screen.getByRole("button", { name: "Copy Excerpt" }));
    expect(clipboard).toHaveBeenCalledWith(exact);
    fireEvent.click(screen.getByRole("button", { name: "Copy note" }));
    expect(clipboard).toHaveBeenLastCalledWith("older exact\n");
    fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
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
    await openRecovery();
    expect(await screen.findByText("Original object unavailable")).toBeTruthy();
    expect(drafts(first.dir).list()).toEqual([saved]);
    expect(emulators.made.has(terminal)).toBe(false);
    expect(screen.getByText(" retained 🧭  ", { normalizer: (text) => text }).textContent).toBe(" retained 🧭  ");
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
    await openRecovery();
    expect(await screen.findByText("Original object unavailable")).toBeTruthy();
    expect(screen.getByText(`${source.terminal_id} · ${source.id}`)).toBeTruthy();
    expect(screen.getByText(exact, { normalizer: (text) => text }).textContent).toBe(exact);
    expect(drafts(first.dir).list()).toEqual([saved]);
    expect((await bound.rpc("terminal.list", null)).find((each) => each.id === liveReplacement.terminal_id)?.running).toBe(true);
    noDelivery();
  }, 60_000);

});
