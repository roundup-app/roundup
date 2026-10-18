// @vitest-environment jsdom
import type { ChildProcess } from "node:child_process";
import { request } from "node:http";
import { build } from "vite";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { RpcError } from "../app/seam";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { realDaemon } from "./realDaemonPlugin";
import { PROOF, startRealDaemon } from "./realDaemonFixture";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
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

    expect([failure instanceof RpcError, failure?.message]).toEqual([true, expect.stringContaining("nowhere")]);
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
