import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import type { AppSeam } from "../app/seam";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { agent, event } from "../testing/nodes";
import { WORKTREE } from "./harness";
import { message } from "../testing/centreFixture";
import { afterEach, expect, it, vi } from "vitest";
import { COMPARISON, openDiff, openFile, saveNote } from "./noteHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("u2540b_save_cancel_and_invalid_ranges", async () => {
  await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  const save = screen.getByRole("button", { name: "Save" });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  keep exact\ntext  " } });
  fireEvent.input(screen.getByRole("spinbutton", { name: "End line" }), { target: { value: "99" } });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.input(screen.getByRole("spinbutton", { name: "End line" }), { target: { value: "1" } });
  fireEvent.input(screen.getByRole("spinbutton", { name: "Start line" }), { target: { value: "2" } });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.input(screen.getByRole("spinbutton", { name: "Start line" }), { target: { value: "0" } });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.input(screen.getByRole("spinbutton", { name: "Start line" }), { target: { value: "1" } });
  fireEvent.input(screen.getByRole("spinbutton", { name: "End line" }), { target: { value: "2" } });
  fireEvent.click(save);
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("  keep exact\ntext  ");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "cancel me" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("list", { name: "Notes" }).textContent).not.toContain("cancel me");
});

it("u2540b_close_and_reopen_keep_unsent_notes", async () => {
  await openDiff();
  await saveNote("retain me");
  expect(screen.queryByRole("button", { name: "Recover Changes drafts" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  expect((await screen.findByRole("list", { name: "Notes" })).textContent).toContain("retain me");
});

it("u2540b_edit_remove_and_batch_across_files", async () => {
  await openDiff();
  await saveNote("first");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await openFile("src/deep/b.ts");
  await saveNote("second");
  fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "edited first" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const batch = screen.getByRole("list", { name: "Notes" });
  expect(batch.textContent).toContain("edited first");
  expect(batch.textContent).toContain("src/deep/b.ts");
  fireEvent.click(screen.getByRole("button", { name: "Remove note 1" }));
  expect(batch.textContent).not.toContain("edited first");
  expect(batch.textContent).toContain("second");
});

it("u2773a_changes_agent_switch_restores_form", async () => {
  const { app, connected } = await openDiff();
  await saveNote("for a only");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  unfinished a 🐝\n  " } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  app.handlers["rail.tree"] = () => [agent("a", "working", "building", { worktree: WORKTREE }), agent("b", "working", "building", { worktree: { ...WORKTREE, branch: "roundup/b", path: "/p/b" } })];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(connected.rail.nodes.some(node => node.id === "b")).toBe(true));
  connected.rail.select("b");
  fireEvent.click(screen.getByRole("button", { name: "roundup/b" }));
  expect(screen.queryByRole("list", { name: "Notes" })).toBeNull();
  await openFile();
  await saveNote("for b only");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  unfinished b e\u0301\n  " } });
  connected.rail.select("a");
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  const batch = await screen.findByRole("list", { name: "Notes" });
  expect(batch.textContent).toContain("for a only");
  expect(batch.textContent).not.toContain("for b only");
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  unfinished a 🐝\n  ");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
  app.handlers["message.send"] = params => message(1, { to: params.to, body: params.body });
  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  connected.rail.select("b");
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  expect(app.calls.find(call => call.method === "message.send")?.params).toMatchObject({ to: "a" });
  fireEvent.click(screen.getByRole("button", { name: "roundup/b" }));
  expect((await screen.findByRole("list", { name: "Notes" })).textContent).toContain("for b only");
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  unfinished b e\u0301\n  ");
});

it("u2540b_refresh_keeps_original_context", async () => {
  const { app } = await openDiff();
  await saveNote("original");
  app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, new: { kind: "text", revision: "later-revision", text: "different\n" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await within(screen.getByRole("list", { name: "Notes" })).findByRole("status");
  fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "original");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  app.handlers["message.send"] = params => message(1, { body: params.body, to: params.to });
  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  const body = app.calls.find(call => call.method === "message.send")!.params;
  expect(JSON.stringify(body)).toContain("new-revision");
  expect(JSON.stringify(body)).not.toContain("later-revision");
});


it("u2773a_changes_restores_exact_work", async () => {
  const { view } = await openDiff();
  await saveNote("  saved e\u0301 🐝\nexact  ");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  unfinished 🐝\n e\u0301  " } });
  fireEvent.input(screen.getByRole("spinbutton", { name: "End line" }), { target: { value: "2" } });
  view.unmount();
  const { app } = await openDiff();
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("  saved e\u0301 🐝\nexact  ");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  unfinished 🐝\n e\u0301  ");
  expect(screen.getByRole("spinbutton", { name: "End line" })).toHaveProperty("value", "2");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});


it("u2773a_changes_project_switch_restores_caret_without_background_focus", async () => {
  for (const path of ["/project/one", "/project/two"]) {
    const { view } = await openDiff(path);
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Note" });
    fireEvent.input(field, { target: { value: `  ${path} e\u0301\n🐝  ` } });
    field.setSelectionRange(2, 7, "backward");
    fireEvent.select(field);
    view.unmount();
  }

  for (const path of ["/project/two", "/project/one"]) {
    const { app, view } = await openDiff(path);
    const add = screen.getByRole("button", { name: "Add note" });
    add.focus();
    app.emit(event({ name: "rail.changed" }));
    expect(document.activeElement).toBe(add);
    fireEvent.click(add);
    const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Note" });
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.value).toBe(`  ${path} e\u0301\n🐝  `);
    expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([2, 7, "backward"]);
    expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
    view.unmount();
  }
});

it("u2773e_recovery_actions_keep_surface_draft", async () => {
  const { app, view } = await openDiff();
  await saveNote("older saved note");
  const before = localStorage.getItem("roundup:drafts:/p");
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  memory 🐝\nnewer  " } });
  expect(screen.getByRole("alert").textContent).toContain("p");
  expect(localStorage.getItem("roundup:drafts:/p")).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "Review recovery options" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Worktree" })).toBeNull());
  const recovery = await screen.findByRole("dialog", { name: "Recover Changes drafts" });
  const copyText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copyText } });
  fireEvent.click(within(recovery).getAllByRole("button", { name: "Copy" })[0]!);
  await waitFor(() => expect(copyText).toHaveBeenCalledOnce());
  expect(copyText.mock.calls[0]?.[0]).toContain("memory 🐝");
  write.mockRestore();
  fireEvent.click(within(recovery).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(within(recovery).queryByRole("alert")).toBeNull());
  view.unmount();
  const reopened = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  memory 🐝\nnewer  ");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const blockedWrite = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "temporary" } });
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  memory 🐝\nnewer  " } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  blockedWrite.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Recover Changes drafts" }));
  const recovered = await screen.findByRole("dialog", { name: "Recover Changes drafts" });
  // The form is first; discard only that draft, keeping the older saved batch note.
  fireEvent.click(within(recovered).getAllByRole("button", { name: "Discard this draft" })[0]!);
  expect(recovered.textContent).not.toContain("memory 🐝");
  reopened.view.unmount();
  await openDiff();
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("older saved note");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
  expect(reopened.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it.each(["invalid", "unreadable"])("u2773e_changes_restore_failure_keeps_memory_%s", async cause => {
  const original = cause === "invalid" ? "{broken" : null;

  if (original) localStorage.setItem("roundup:drafts:/p", original);
  const read = cause === "unreadable" ? vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); }) : null;
  await openDiff();
  expect(screen.getByRole("alert").textContent).toContain("p");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "retain exact newer" } });
  read?.mockRestore();

  if (original) expect(localStorage.getItem("roundup:drafts:/p")).toBe(original);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "retain exact newer");
});

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
      fireEvent.click(screen.getByRole("button", { name: node.worktree!.branch }));
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
      fireEvent.click(screen.getByRole("button", { name: target.branch }));
      await openFile("same.ts");
      expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain(`  Project ${index} e\u0301\n🐝  `);
      await within(screen.getByRole("list", { name: "Notes" })).findByRole("status");
      fireEvent.click(screen.getByRole("button", { name: "Add note" }));
      expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", `unfinished ${index}\n  🐝`);
      expect(screen.getByRole("spinbutton", { name: "End line" })).toHaveProperty("value", "2");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(calls.mock.calls.filter(([method]) => method === "message.send")).toHaveLength(0);
      await app.rpc("takeover.begin", { agent: target.id });
      fireEvent.click(screen.getByRole("button", { name: "Send notes to Same name" }));
      await waitFor(async () => expect(await app.rpc("message.list", { to: target.id, status: null })).toHaveLength(1));
      const accepted = (await app.rpc("message.list", { to: target.id, status: null }))[0]!;
      expect(accepted).toMatchObject({ to: target.id, kind: "note", status: "held", reason: "takeover" });
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
      await waitFor(() => expect(screen.queryByRole("list", { name: "Notes" })).toBeNull());
      expect(await app.rpc("message.list", { to: target.id, status: null })).toHaveLength(1);
      expect(calls.mock.calls.filter(([method]) => method === "message.send")).toHaveLength(1);
      view.unmount();
    }
  } finally {
    cleanup();
    await Promise.all(projects.map(real => real.stop()));
    await rm(logs, { recursive: true, force: true });
  }
}, 180_000);


it("u2773c_changes_worktree_loss_and_return_keep_original_form", async () => {
  const { app, connected } = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  original Worktree e\u0301\n🐝  " } });
  expect(screen.queryByRole("button", { name: "Recover Changes drafts" })).toBeNull();
  app.handlers["rail.tree"] = () => [agent("a", "working", "building", { worktree: null })];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(connected.rail.nodes.find(node => node.id === "a")?.worktree).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Recover Changes drafts" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover Changes drafts" });
  expect(recovery.textContent).toContain("  original Worktree e\u0301\n🐝  ");
  expect(within(recovery).queryByRole("button", { name: "Resume note" })).toBeNull();
  fireEvent.click(within(recovery).getByRole("button", { name: "Close" }));
  app.handlers["rail.tree"] = () => [agent("a", "working", "building", { worktree: WORKTREE })];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Recover Changes drafts" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  original Worktree e\u0301\n🐝  ");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u2773c_changes_unavailable_original_keeps_recovery", async () => {
  const { app, connected } = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  unavailable exact 🐝  " } });
  app.handlers["rail.tree"] = () => [agent("replacement", "working", "building", { name: "a", worktree: WORKTREE })];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(connected.rail.nodes.some(node => node.id === "a")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Recover Changes drafts" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover Changes drafts" });
  expect(recovery.textContent).toContain("  unavailable exact 🐝  ");
  expect(within(recovery).getByRole("status")).toBeTruthy();
  expect(within(recovery).queryByRole("button", { name: "Resume note" })).toBeNull();
  const copied = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copied } });
  fireEvent.click(within(recovery).getAllByRole("button", { name: "Copy" })[1]!);
  await waitFor(() => expect(copied).toHaveBeenCalledOnce());
  expect(JSON.parse(copied.mock.calls[0]?.[0] ?? "null")).toMatchObject({ recipient: "a", form: { text: "  unavailable exact 🐝  ", comparison: COMPARISON } });
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u2773e_changes_retry_read_keeps_older_work_separate", async () => {
  const first = await openDiff();
  await saveNote("older retained work");
  first.view.unmount();
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("temporarily unreadable"); });
  const current = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "newer memory work" } });
  read.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Recover Changes drafts" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover Changes drafts" });
  fireEvent.click(within(recovery).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(recovery.textContent).toContain("older retained work"));
  expect(recovery.textContent).toContain("newer memory work");
  current.view.unmount();
  const reopened = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "newer memory work");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Recover Changes drafts" }));
  expect((await screen.findByRole("dialog", { name: "Recover Changes drafts" })).textContent).toContain("older retained work");
  expect(reopened.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u2773a_changes_recovery_switch_keeps_single_editor", async () => {
  const { app } = await openDiff();
  const blockedWrite = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "first editor work" } });
  blockedWrite.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Recover Changes drafts" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover Changes drafts" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Worktree" })).toBeNull());
  fireEvent.click(within(recovery).getByRole("button", { name: "Resume note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "newer recovery editor work 🐝" } });
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover Changes drafts" })).toBeNull());
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "newer recovery editor work 🐝");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});


it("u2773e_changes_connection_replacement_keeps_memory", async () => {
  const first = await openDiff();
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  original memory e\u0301\n🐝  " } });
  expect(screen.getByRole("alert")).toBeTruthy();
  first.view.unmount();
  write.mockRestore();
  const next = await openDiff("/p", first.connected.drafts);
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  original memory e\u0301\n🐝  ");
  expect(next.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
  next.app.handlers["message.send"] = params => message(1, { to: params.to, body: params.body });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await waitFor(() => expect(next.app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  expect(next.app.calls.find(call => call.method === "message.send")?.params).toMatchObject({ to: "a" });
  expect(first.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u3474e_mutation_keeps_the_next_key_live", async () => {
  await openDiff();
  await saveNote("first");
  await saveNote("second");
  const remove = screen.getByRole("button", { name: "Remove note 1" });
  remove.focus();
  fireEvent.click(remove);
  const next = screen.getByRole("button", { name: "Remove note 1" });
  await waitFor(() => expect(document.activeElement).toBe(next));
  fireEvent.click(document.activeElement!);
  await waitFor(() => expect(screen.queryByRole("list", { name: "Notes" })).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" }));
});

it("u3474e_saving_a_note_returns_to_a_live_control", async () => {
  await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  const field = screen.getByRole("textbox", { name: "Note" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.input(field, { target: { value: "keep this" } });
  const save = screen.getByRole("button", { name: "Save" });
  save.focus();
  fireEvent.click(save);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add note" })));
  fireEvent.click(document.activeElement!);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Note" })));
});


it("u3474e_sending_the_batch_returns_to_a_live_control", async () => {
  const { app } = await openDiff();
  await saveNote("reviewed");
  app.handlers["message.send"] = params => message(1, { to: params.to, body: params.body });
  const send = screen.getByRole("button", { name: /Send notes to/ });
  send.focus();
  fireEvent.click(send);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" })));
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1);
  fireEvent.click(document.activeElement!);
  expect(await screen.findByRole("button", { name: "View diff" })).toBeTruthy();
});

it.each(["dismiss", "copy same", "copy other", "discard", "failed discard"])("p3557c_failure_lifetime_note_recovery: %s", async action => {
  const { app, connected } = await openDiff();
  await saveNote("  copied note e\u0301\n🐝  ");
  await saveNote("  other note 🐝  ");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  unfinished e\u0301\n🐝  " } });
  app.handlers["rail.tree"] = () => [agent("plain", "working", "building")];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(connected.rail.nodes.some(node => node.id === "a")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Recover Changes drafts" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover Changes drafts" });
  const first = within(recovery).getByText("  copied note e\u0301\n🐝  ", { normalizer: value => value }).parentElement!;
  const other = within(recovery).getByText("  other note 🐝  ", { normalizer: value => value }).parentElement!;
  const copied = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error("clipboard refused"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copied } });
  fireEvent.click(within(first).getByRole("button", { name: "Copy" }));
  await within(recovery).findByRole("alert");
  copied.mockResolvedValue();
  let blocked: ReturnType<typeof vi.spyOn> | undefined;

  if (action === "dismiss") fireEvent.click(within(recovery).getByRole("button", { name: "Dismiss" }));
  else if (action.includes("discard")) {
    if (action === "failed discard") blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk refused"); });
    fireEvent.click(within(first).getByRole("button", { name: "Discard this draft" }));
  } else {
    fireEvent.click(within(action === "copy same" ? first : other).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(copied).toHaveBeenCalledTimes(2));
  }

  await waitFor(() => expect(within(recovery).queryAllByRole("alert").length > 0).toBe(action === "copy other" || action === "failed discard"));
  expect(recovery.textContent).toContain("  other note 🐝  ");
  expect(recovery.textContent).toContain("  unfinished e\u0301\n🐝  ");
  expect(JSON.parse(copied.mock.calls[0]![0])).toMatchObject({ project: "/p", recipient: "a", note: { text: "  copied note e\u0301\n🐝  " } });
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
  blocked?.mockRestore();
});

it.each(["save", "cancel"])("p3557c_failure_lifetime_note_recovery_form: %s", async action => {
  const { app } = await openDiff();
  await saveNote("unrelated saved note");
  app.handlers["message.send"] = () => { throw new Error("reply lost"); };

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await screen.findByRole("button", { name: "Check Message history" });
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  exact form e\u0301\n🐝  " } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Recover Changes drafts" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover Changes drafts" });
  const form = within(recovery).getByText("  exact form e\u0301\n🐝  ", { normalizer: value => value }).parentElement!;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("refused")) } });
  fireEvent.click(within(form).getByRole("button", { name: "Copy" }));
  await within(recovery).findByRole("alert");
  fireEvent.click(within(form).getByRole("button", { name: "Resume note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  exact form e\u0301\n🐝  ");
  fireEvent.click(within(recovery).getByRole("button", { name: action === "save" ? "Save" : "Cancel" }));
  await waitFor(() => expect(within(recovery).queryByRole("alert") !== null).toBe(action === "cancel"));
  expect(recovery.textContent).toContain("  exact form e\u0301\n🐝  ");
  expect(recovery.textContent).toContain("unrelated saved note");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1);
});
