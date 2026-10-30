import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { AppSeam } from "../app/seam";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { openFile, saveNote } from "./noteHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("u2773c_changes_external_change_keeps_original", async () => {
  const { join } = await import("node:path");
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { startWorktreeProject } = await import("../testing/realDaemonFixture");
  const { createServedApp } = await import("../testing/realSeam");
  const { connectProject, ConnectedProjectContext } = await import("../state/connectedProject");
  const { WorktreeControl } = await import("./WorktreeControl");
  const { render } = await import("@solidjs/testing-library");
  const logs = await mkdtemp(join(tmpdir(), "unfinished-changes-log-"));
  const projects: Awaited<ReturnType<typeof startWorktreeProject>>[] = [];
  const targets: { id: string; branch: string; path: string }[] = [];
  const originals: FileComparison[] = [];

  try {
    for (let index = 0; index < 2; index++) {
      const real = await startWorktreeProject({ "same.ts": "original base\n" }, { FAKE_CLAUDE_PROMPT_LOG: join(logs, "prompts.jsonl") });
      projects.push(real);
      const app = createServedApp(real.base);

      if (index === 1) await app.rpc("agent.spawn", { cwd: real.dir, parent: null, prompt: null, name: "Spare", order: { kind: "work", ask: "inspect", limits: [] } });
      const node = await app.rpc("agent.spawn", { cwd: real.dir, parent: null, prompt: null, name: "Same name", order: { kind: "work", ask: "inspect", limits: [] } });
      targets.push({ id: node.id, branch: node.worktree!.branch, path: node.worktree!.path });
      await waitFor(async () => expect((await app.rpc("rail.tree", null)).find(value => value.id === node.id)?.status?.kind).toBe("idle"), { timeout: 30_000 });
      await writeFile(join(node.worktree!.path, "same.ts"), `source ${index}\nsecond line\n`);
      const connected = await connectProject(app, { name: "Same project", path: real.dir }, () => true, () => 0);
      connected.rail.select(node.id);
      const view = render(() => <ConnectedProjectContext.Provider value={connected}><WorktreeControl /></ConnectedProjectContext.Provider>);
      fireEvent.click(await screen.findByRole("button", { name: /\d+ changed files?/ }));
      await openFile("same.ts");
      await saveNote(`  Project ${index} e\u0301\n🐝  `);
      originals.push(await app.rpc("agent.compareFile", { id: node.id, path: "same.ts" }));
      // An external Actor changes disk while a separate exact form remains unfinished.
      fireEvent.click(screen.getByRole("button", { name: "Add note" }));
      fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: `unfinished ${index}\n  🐝` } });
      fireEvent.input(screen.getByRole("spinbutton", { name: "End line" }), { target: { value: "2" } });
      await writeFile(join(node.worktree!.path, "same.ts"), `external replacement ${index}\n`);
      view.unmount();
    }

    expect(targets[0]?.id).not.toBe(targets[1]?.id);

    for (const [index, real] of projects.entries()) {
      const target = targets[index]!;
      const served = createServedApp(real.base);

      const app: AppSeam = { ...served, rpc: async (method, params) => {
        const result = await served.rpc(method, params);

        if (method === "message.send") throw new Error("reply lost after real acceptance");

        return result;
      } };

      const calls = vi.spyOn(app, "rpc");
      const connected = await connectProject(app, { name: "Same project", path: real.dir }, () => true, () => 0);
      connected.rail.select(target.id);
      const view = render(() => <ConnectedProjectContext.Provider value={connected}><WorktreeControl /></ConnectedProjectContext.Provider>);
      fireEvent.click(await screen.findByRole("button", { name: /\d+ changed files?/ }));
      await openFile("same.ts");
      expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain(`  Project ${index} e\u0301\n🐝  `);
      await within(screen.getByRole("list", { name: "Notes" })).findByRole("status");
      fireEvent.click(screen.getByRole("button", { name: "Add note" }));
      expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", `unfinished ${index}\n  🐝`);
      expect(screen.getByRole("spinbutton", { name: "End line" })).toHaveProperty("value", "2");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(calls.mock.calls.filter(([method]) => method === "message.send")).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "Send notes to Same name" }));
      await waitFor(async () => expect((await app.rpc("message.list", { to: target.id, status: null })).filter(message => message.from.kind === "user")).toHaveLength(1));
      const accepted = ((await app.rpc("message.list", { to: target.id, status: null })).filter(message => message.from.kind === "user"))[0]!;
      expect(accepted).toMatchObject({ to: target.id, kind: "note" });
      expect(JSON.parse(accepted.body)).toMatchObject({ notes: [
        { "File:": { old: "same.ts", new: "same.ts" }, "Selected source:": `source ${index}`, "User comment:": `  Project ${index} e\u0301\n🐝  ` },
        { "Selected source:": `source ${index}\nsecond line`, "Lines:": "new 1-2", "User comment:": `unfinished ${index}\n  🐝` },
      ] });
      const original = originals[index]!;
      const payload = JSON.parse(accepted.body);

      for (const note of payload.notes) expect(note).toMatchObject({ "Base:": original.base, "Content revisions:": { old: original.old.revision, new: original.new.revision } });
      expect(accepted.body).not.toContain("external replacement");
      expect(calls.mock.calls.filter(([method]) => method === "message.send")).toHaveLength(1);
      // Lost acceptance is reconciled only by this user action, never by reload or an automatic retry.
      fireEvent.click(await screen.findByRole("button", { name: "Check Message history" }));
      await waitFor(() => expect(screen.queryByRole("list")).toBeNull());
      expect((await app.rpc("message.list", { to: target.id, status: null })).filter(message => message.from.kind === "user")).toHaveLength(1);
      expect(calls.mock.calls.filter(([method]) => method === "message.send")).toHaveLength(1);
      view.unmount();
    }
  } finally {
    cleanup();
    await Promise.all(projects.map(real => real.stop()));
    await rm(logs, { recursive: true, force: true });
  }
}, 60_000);
