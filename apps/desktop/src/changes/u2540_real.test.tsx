import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startRealDaemon, type StartedDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import type { ConnectedProject } from "../state/connectedProject";
import type { RailNode } from "@contracts/agent/RailNode";
import { WorktreeControl } from "./WorktreeControl";
import { openFile, saveNote } from "./noteHarness";

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

afterAll(async () => { cleanup(); await real?.stop();

 if (logs) await rm(logs, { recursive: true, force: true }); });

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
