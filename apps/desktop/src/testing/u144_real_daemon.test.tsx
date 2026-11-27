// @vitest-environment jsdom
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flush } from "solid-js";
import type { AppSeam } from "../app/seam";
import { createServedApp } from "./realSeam";
import { doorOf } from "./nodes";
import { startRealDaemon } from "./realDaemonFixture";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import type { ConnectedProject } from "../state/connectedProject";
import type { RailNode } from "@contracts/agent/RailNode";
import { ChangesView } from "../changes/ChangesView";
import { copy } from "../changes/copy";
import { WorktreeControl } from "../changes/WorktreeControl";
import { openFile, openChanges, startNote } from "../changes/noteHarness";
import type { StartedDaemon } from "./realDaemonFixture";
import { ToastHost } from "./toastHost";

/** U7186a: an Agent owns what its recorded file writes touched, so the test records the write it made to the Agent's Worktree. */
const recordWrite = (app: AppSeam, node: RailNode, file: string) => app.rpc("agent.signal", { id: node.id, attempt: doorOf(node)!.attempt!, payload: { hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(doorOf(node)!.worktree!.path, file) } } });

describe("u2540 inspection and notes on the real Daemon", () => {
  const execute = promisify(execFile);

  let real: StartedDaemon;

  let connected: ConnectedProject;

  let first: RailNode;

  let second: RailNode;

  const git = (...args: string[]) => execute("git", ["-C", real.dir, ...args], { timeout: 30_000 });

  const mount = () => render(() => {
    connected.worktrees.watch(() => true);

    return <ToastHost><ConnectedProjectContext value={connected}><WorktreeControl /><ChangesView /></ConnectedProjectContext></ToastHost>;
  });

  beforeAll(async () => {
    // The fake enables its session/prompt loop with this setting; these observers need no log.
    real = await startRealDaemon({ FAKE_CLAUDE_PROMPT_LOG: "/dev/null" });
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
    await waitFor(async () => expect((await app.rpc("rail.tree", null)).filter(node => node.id === first.id || node.id === second.id).every(node => doorOf(node)?.status?.kind === "idle")).toBe(true), { timeout: 30_000 });
    await writeFile(join(real.dir, "same.ts"), "project source\n");
    await writeFile(join(doorOf(first)!.worktree!.path, "same.ts"), "first source\n");
    await writeFile(join(doorOf(second)!.worktree!.path, "same.ts"), "second source\n");
    await Promise.all([first, second].map(node => recordWrite(app, node, "same.ts")));
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
      flush();
      await connected.owned.refresh(node.id);
      await openChanges();
      await openFile("same.ts");
      const comparison = await connected.app.rpc("agent.compareFile", { id: node.id, path: "same.ts" });
      expect(comparison.new).toMatchObject({ kind: "text", text: node.id === first.id ? "first source\n" : "second source\n" });
      fireEvent.click(within(screen.getByRole("region", { name: copy.changes })).getByRole("button", { name: "Close changes" }));
      await waitFor(() => expect(screen.queryByRole("region", { name: copy.changes })).toBeNull());
    }

    cleanup();
  });

  it("u2540d_landing_is_independent_of_diff_and_notes", async () => {
    cleanup();
    const { app } = connected;
    const node = await app.rpc("agent.spawn", { cwd: real.dir, parent: null, prompt: null, name: "Landing", order: { kind: "work", ask: "inspect", limits: [] } });
    const path = doorOf(node)!.worktree!.path;

    await recordWrite(app, node, "same.ts");
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
        await connected.owned.refresh(node.id);

        if (phase !== "before inspection") {
          await openChanges();
          await openFile("same.ts");

          if (phase === "with notes") {
            startNote();
            fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: unsent } });
            fireEvent.click(screen.getByRole("button", { name: "Save" }));
          }

          fireEvent.click(within(screen.getByRole("region", { name: copy.changes })).getByRole("button", { name: "Close changes" }));
          await waitFor(() => expect(screen.queryByRole("region", { name: copy.changes })).toBeNull());
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
