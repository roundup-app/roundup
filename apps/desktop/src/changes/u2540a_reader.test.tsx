import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { COMPARISON, openDiff, saveNote } from "./noteHarness";
import { RpcError } from "../app/seam";
import { mountControl } from "./harness";
import { createSignal } from "solid-js";
import { ConnectedProjectContext } from "../state/connectedProject";
import { DiffReader } from "./DiffReader";
import { notesFor } from "./notes";

import { VirtualizedFileDiff, Virtualizer, processFile } from "@pierre/diffs";
import { createTwoFilesPatch, structuredPatch } from "diff";
import { copy as readerCopy } from "./copy";

// ESM exports are non-configurable: spy mode records the scenario's library calls while executing the real implementation.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@pierre/diffs", { spy: true });

// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("diff", { spy: true });

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); localStorage.clear(); });

const rendered = () => vi.mocked(VirtualizedFileDiff.prototype.render).mock.calls.filter(([input]) => input?.fileDiff);

it("u5646a_equal_replies_keep_render_and_selection", async () => {
  const { app, connected } = await openDiff();
  await waitFor(() => expect(rendered()).toHaveLength(1));
  const click = vi.mocked(VirtualizedFileDiff).mock.calls[0]![0]!.onLineNumberClick!;
  // Pierre supplies this public callback when the user selects line numbers.
  const line = (lineNumber: number, shiftKey = false) => click({ type: "diff-line", lineType: "change-deletion", lineElement: document.createElement("div"), numberElement: document.createElement("span"), numberColumn: true, lineNumber, annotationSide: "deletions", event: new PointerEvent("click", { shiftKey }) });
  line(1); line(2, true);
  const add = screen.getByRole("button", { name: "Add note" });
  add.focus();

  for (let i = 0; i < 2; i++) await connected.worktrees.refresh("a");
  await waitFor(() => expect(app.calls.filter(call => call.method === "agent.compareFile")).toHaveLength(3));
  expect(createTwoFilesPatch).toHaveBeenCalledTimes(1);
  expect(processFile).toHaveBeenCalledTimes(1);
  expect(VirtualizedFileDiff).toHaveBeenCalledTimes(1);
  expect(rendered()).toHaveLength(1);
  expect(VirtualizedFileDiff.prototype.cleanUp).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(add);
  fireEvent.click(add);
  expect(screen.getByRole("tab", { name: "Old" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("spinbutton", { name: "Start line" })).toHaveProperty("value", "1");
  expect(screen.getByRole("spinbutton", { name: "End line" })).toHaveProperty("value", "2");
});

it.each([
  { base: "other-base" }, { oldPath: "other-old.ts" }, { newPath: "other-new.ts" },
  { status: "added" as const },
  { old: { ...COMPARISON.old, revision: "other-old" } },
  { new: { ...COMPARISON.new, revision: "other-new" } },
  { old: { kind: "absent" as const, revision: COMPARISON.old.revision } },
  { new: { kind: "absent" as const, revision: COMPARISON.new.revision } },
  { old: { kind: "binary" as const, revision: COMPARISON.old.revision } }, { status: null },
])("u5646a_changed_identity_updates_content: %j", async change => {
  const { app, connected } = await openDiff();
  await waitFor(() => expect(rendered()).toHaveLength(1));
  app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, ...change });
  await connected.worktrees.refresh("a");
  const text = change.status !== null && change.old?.kind !== "binary";
  await waitFor(() => expect(VirtualizedFileDiff.prototype.cleanUp).toHaveBeenCalledTimes(1));

  if (text) await waitFor(() => expect(rendered()).toHaveLength(2));
  else {
    await screen.findByText(change.status === null ? readerCopy.noDifference : readerCopy.binaryDiff);
    expect(document.querySelector("diffs-container")).toBeNull();
    app.handlers["agent.compareFile"] = () => COMPARISON;
    await connected.worktrees.refresh("a");
    await waitFor(() => expect(rendered()).toHaveLength(2));
  }

  expect(createTwoFilesPatch).toHaveBeenCalledTimes(2);
  expect(processFile).toHaveBeenCalledTimes(2);
  expect(VirtualizedFileDiff).toHaveBeenCalledTimes(2);
});

it.each([{ id: "plain", path: "src/a.ts" }, { id: "a", path: "src/deep/b.ts" }])("u5646a_changed_target_rejects_equal_identity_and_stale_reply: %j", async target => {
  const { app, connected, view } = await mountControl();

  view.unmount();
  const [requested, setRequested] = createSignal({ id: "a", path: "src/a.ts" });
  const notes = notesFor(app, "/p");

  app.handlers["agent.compareFile"] = () => structuredClone(COMPARISON);
  render(() => <ConnectedProjectContext.Provider value={connected}><DiffReader id={requested().id} path={requested().path} name="a" notes={notes} onEdited={() => {}} onBack={() => {}} onClose={() => {}} recover={() => {}} /></ConnectedProjectContext.Provider>);
  await waitFor(() => expect(rendered()).toHaveLength(1));
  let finish!: (value: typeof COMPARISON) => void;

  app.handlers["agent.compareFile"] = () => new Promise(resolve => { finish = resolve; });
  setRequested({ id: "a", path: "pending.ts" });
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  app.handlers["agent.compareFile"] = () => structuredClone(COMPARISON);
  setRequested(target);
  await waitFor(() => expect(rendered()).toHaveLength(2));
  expect(app.calls.filter(call => call.method === "agent.compareFile").at(-1)?.params).toEqual(target);
  finish({ ...COMPARISON, new: { kind: "text", revision: "stale", text: "stale\n" } });
  // reply() unwraps its awaited RPC before DiffReader's .then runs.
  await Promise.resolve();
  await Promise.resolve();
  expect(rendered()).toHaveLength(2);
  expect(processFile).toHaveBeenCalledTimes(2);
});

it("u5646c_equal_refresh_keeps_fallback_notice", async () => {
  const boundedPatch: (...args: Parameters<typeof createTwoFilesPatch>) => string | undefined = createTwoFilesPatch;

  vi.mocked(boundedPatch).mockReturnValueOnce(undefined);
  const { app, connected } = await openDiff();
  await screen.findByText(readerCopy.replacementDiff);

  for (let i = 0; i < 2; i++) {
    let finish!: (value: typeof COMPARISON) => void;
    app.handlers["agent.compareFile"] = () => new Promise(resolve => { finish = resolve; });
    await connected.worktrees.refresh("a");
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(screen.queryByText(readerCopy.replacementDiff)).not.toBeNull();
    finish(structuredClone(COMPARISON));
    await waitFor(() => expect(screen.queryByText(readerCopy.replacementDiff)).not.toBeNull());
  }

  expect(createTwoFilesPatch).toHaveBeenCalledTimes(1);
  expect(structuredPatch).toHaveBeenCalledTimes(2);
  expect(processFile).toHaveBeenCalledTimes(1);
  expect(rendered()).toHaveLength(1);
  app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, new: { kind: "text", revision: "next", text: "next\n" } });
  await connected.worktrees.refresh("a");
  await waitFor(() => expect(rendered()).toHaveLength(2));
  expect(screen.queryByText(readerCopy.replacementDiff)).toBeNull();
});

it("u5646d_refresh_recovery_and_disposal", async () => {
  const { app, connected, view } = await openDiff();
  await waitFor(() => expect(rendered()).toHaveLength(1));
  const click = vi.mocked(VirtualizedFileDiff).mock.calls[0]![0]!.onLineNumberClick!;

  click({ type: "diff-line", lineType: "change-deletion", lineElement: document.createElement("div"), numberElement: document.createElement("span"), numberColumn: true, lineNumber: 2, annotationSide: "deletions", event: new PointerEvent("click") });
  app.handlers["agent.compareFile"] = () => { throw new Error("read refused"); };

  await connected.worktrees.refresh("a");
  await screen.findByRole("alert");
  expect(rendered()).toHaveLength(1);
  expect(vi.mocked(VirtualizedFileDiff.prototype.setSelectedLines).mock.calls.at(-1)?.[0]).toEqual({ side: "deletions", start: 2, end: 2 });
  app.handlers["agent.compareFile"] = () => structuredClone(COMPARISON);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(processFile).toHaveBeenCalledTimes(1);
  expect(rendered()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("spinbutton", { name: "Start line" })).toHaveProperty("value", "2");
  expect(screen.getByRole("tab", { name: "Old" }).getAttribute("aria-selected")).toBe("true");
  const before = app.calls.filter(call => call.method === "agent.compareFile").length;

  await connected.worktrees.refresh("plain");
  expect(app.calls.filter(call => call.method === "agent.compareFile")).toHaveLength(before);
  view.unmount();
  expect(VirtualizedFileDiff.prototype.cleanUp).toHaveBeenCalledTimes(1);
  expect(Virtualizer.prototype.cleanUp).toHaveBeenCalledTimes(1);
  const reads = app.calls.filter(call => call.method === "agent.compareFile").length;
  await connected.worktrees.refresh("a");
  expect(app.calls.filter(call => call.method === "agent.compareFile")).toHaveLength(reads);
});

it("u2540a_open_back_close_and_editor_actions", async () => {
  const { app, connected } = await mountControl();

  await connected.worktrees.refresh("a");
  app.handlers["agent.compareFile"] = () => ({ base: "base-commit", oldPath: "src/a.ts", newPath: "src/a.ts", status: "modified", old: { kind: "text", revision: "old-revision", text: "before\n" }, new: { kind: "text", revision: "new-revision", text: "after\n" } });
  fireEvent.click(screen.getByRole("button", { name: /\d+ changed files?/ }));
  await waitFor(() => expect(document.querySelector("file-tree-container")).not.toBeNull());
  const row = document.querySelector("file-tree-container")!.shadowRoot!.querySelector('[data-item-path="src/a.ts"]')!;
  fireEvent.click(row, { composed: true });
  fireEvent.click(screen.getByRole("button", { name: "View diff" }));
  await screen.findByRole("button", { name: /Add note/ });
  expect(app.calls.filter(c => c.method === "agent.compareFile").at(-1)?.params).toEqual({ id: "a", path: "src/a.ts" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(document.querySelector("file-tree-container")?.shadowRoot?.activeElement?.getAttribute("data-item-path")).toBe("src/a.ts"));
  fireEvent.keyDown(document.querySelector("file-tree-container")!.shadowRoot!.activeElement!, { key: "Enter", composed: true });
  await waitFor(() => expect(app.editorCalls).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /\d+ changed files?/ }));
});

it("u2540a_late_content_cannot_cross_agents", async () => {
  const { app, connected } = await mountControl();
  let resolve!: (value: typeof COMPARISON) => void;
  app.handlers["agent.compareFile"] = () => new Promise(done => { resolve = done; });
  fireEvent.click(screen.getByRole("button", { name: /\d+ changed files?/ }));
  await waitFor(() => expect(document.querySelector("file-tree-container")).not.toBeNull());
  fireEvent.click(document.querySelector("file-tree-container")!.shadowRoot!.querySelector('[data-item-path="src/a.ts"]')!, { composed: true });
  fireEvent.click(screen.getByRole("button", { name: "View diff" }));
  await waitFor(() => expect(app.calls.some(call => call.method === "agent.compareFile")).toBe(true));
  connected.rail.select("plain");
  resolve(COMPARISON);
  await Promise.resolve();
  expect(screen.queryByRole("region", { name: /Diff/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Add note/ })).toBeNull();
});

it("u2540a_nontext_empty_and_failed_reads_remain_navigable", async () => {
  const { app, connected } = await openDiff();
  app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, old: { kind: "binary", revision: "binary" } });
  await connected.worktrees.refresh("a");
  await waitFor(() => expect(screen.queryByRole("button", { name: /Add note/ })).toBeNull());
  app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, status: null });
  await connected.worktrees.refresh("a");
  await screen.findByText(/No remaining difference/);
  app.handlers["agent.compareFile"] = () => { throw new RpcError(-32001, "Worktree unavailable"); };

  await connected.worktrees.refresh("a");
  await screen.findByRole("alert");
  app.handlers["agent.compareFile"] = () => COMPARISON;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: /Add note/ });
  fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it.each(["retry", "dismiss", "signal"])("u5558e_failed_reload_retains_data: %s", async action => {
  const { app, connected } = await openDiff();
  const retainedNote = "  unrelated note e\u0301\n🐝  ";

  await saveNote(retainedNote);
  fireEvent.click(screen.getByRole("button", { name: /Add note/ }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  unfinished e\u0301\n🐝  " } });
  const retained = connected.drafts.list();

  app.handlers["agent.compareFile"] = () => { throw new Error("comparison refused; retry loading this diff"); };

  await connected.worktrees.refresh("a");
  await screen.findByRole("alert");

  if (action === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  else {
    app.handlers["agent.compareFile"] = () => COMPARISON;

    if (action === "signal") await connected.worktrees.refresh("a");
    else fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  }

  expect(screen.queryByRole("alert")).toBeNull();
  expect(await screen.findByRole("textbox", { name: "Note" })).toHaveProperty("value", "  unfinished e\u0301\n🐝  ");
  expect(connected.drafts.list()).toEqual(retained);
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});
