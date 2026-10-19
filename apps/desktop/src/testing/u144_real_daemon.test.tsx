// @vitest-environment jsdom
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

  const mount = () => render(() => <App app={app} drafts={drafts} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);

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
    window.localStorage.clear();
    drafts = createProjectDrafts();
    const served = createServedApp(first.base);
    original = await served.rpc("rail.createWorkstream", { name: `same name ${seed}`, parent: null });
    replacement = await served.rpc("rail.createWorkstream", { name: `replacement ${seed}`, parent: null });
    const other = createServedApp(second.base);
    otherOriginal = await other.rpc("rail.createWorkstream", { name: `same name ${seed}`, parent: null });
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

  it("u2773h_retention_failure_preserves_closed_project_memory", async () => {
    await setup();
    const holder = drafts(first.dir);
    let headerFactory: typeof drafts | undefined;
    const setWindowTitle = app.setWindowTitle;

    app.setWindowTitle = async (title) => {
      headerFactory ??= useContext(ProjectDraftsContext);
      await setWindowTitle(title);
    };

    const write = Storage.prototype.setItem;

    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("roundup:drafts:")) throw new Error("disk full");

      write.call(this, key, value);
    });

    const saved = holder.edit(target(), { ask: exact, title: "same name", done: "later" }, { start: 3, end: 7, direction: "forward" }, "ordinary").draft;
    mount();
    await openRecovery();
    expect((await screen.findByRole("alert")).textContent).toContain(first.dir);
    expect(screen.getByRole("alert").textContent).toContain("Order");
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
    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "first" });
    await openRecovery();
    expect(drafts(first.dir)).toBe(holder);
    expect(holder.list()).toEqual([saved, headerSaved]);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(saved.revision) }));
    expect(screen.getByText(exact, { normalizer: (text) => text }).textContent).toBe(exact);
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

  it.each(["exit", "remove"] as const)("u2773a_terminal_selection_restores_exact_work_shared_%s", async (ending) => {
    await setup();
    const bound = app.forProject(first.dir);
    const source = await bound.rpc("rail.startDoor", { id: original.id });
    const terminal = source.terminal_id!;
    const holder = drafts(first.dir);
    const destination = { surface: "terminal_selection", object: terminal, recipient: source.id };
    const a = holder.edit(destination, { note: "older exact\n", excerpt: exact }, null, "ordinary").draft;
    holder.submit(a.revision);
    holder.settle(a.revision, "unknown");
    const b = holder.edit(destination, { note: exact, excerpt: " captured 🧭\n" }, { start: 2, end: 5, direction: "backward" }, "ordinary").draft;
    mount();
    await openRecovery();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(a.revision) }));
    const inspect = screen.getByRole("button", { name: new RegExp(a.revision) });
    inspect.focus();
    calls.forEach((spy) => spy.mockClear());
    if (ending === "exit") await bound.rpc("terminal.kill", { id: terminal });
    else await bound.rpc("rail.remove", { id: source.id });
    await screen.findByText("Original object unavailable");
    expect(document.activeElement).toBe(inspect);
    expect(holder.list()).toEqual([expect.objectContaining({ revision: a.revision, status: "unknown" }), b]);
    expect(screen.getByText(new RegExp(source.id)).textContent).toContain(terminal);
    expect(screen.getByText(exact, { normalizer: (text) => text }).textContent).toBe(exact);
    const tree = await bound.rpc("rail.tree", null);
    expect(tree.some((node) => node.id === source.id)).toBe(ending === "exit");
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    fireEvent.click(screen.getByRole("tab", { name: "first" }));
    await openRecovery();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(a.revision) }));
    expect(screen.getByRole("img", { name: "Acceptance unknown" })).toBeTruthy();
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fireEvent.click(screen.getByRole("button", { name: "Copy excerpt" }));
    expect(clipboard).toHaveBeenCalledWith(exact);
    holder.retry();
    fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
    expect(createProjectDrafts()(first.dir).list()).toEqual([b]);
    cleanup();
    drafts = createProjectDrafts();
    mount();
    await openRecovery();
    await screen.findByText("Original object unavailable");
    expect(drafts(first.dir).list()).toEqual([b]);
    expect(await bound.rpc("terminal.list", null)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: terminal, running: true })]));
    noDelivery();
  }, 60_000);

});
