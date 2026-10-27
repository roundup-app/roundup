import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../../App";
import { createFakeApp } from "../../testing/fakeApp";
import { agent, workstream } from "../../testing/nodes";
import { rowOf } from "../railFixture";
import { fakeEmulators } from "../../terminal/paneHarness";
import { useBrowserStorage } from "../../state/storage";
import { stubDialogLayout, answerQuestion } from "../../shelf/bulkQuestionHarness";
import type { Removal } from "@contracts/agent/Removal";

stubDialogLayout();
afterEach(cleanup);

it.each(["menu", "key"])("u3787a_rail_%s_deletes_without_question_and_restores_retained_identity", async entry => {
  localStorage.clear();
  useBrowserStorage(localStorage);
  const app = createFakeApp();
  const nodes = [workstream("chosen"), agent("other", "idle", "idle", { terminal_id: null })];
  app.add("/p");
  const daemon = app.of("/p");
  daemon.handlers["rail.tree"] = () => nodes;
  let receipt: Removal | null = null;
  daemon.handlers["rail.deletion"] = () => receipt;
  daemon.handlers["rail.remove"] = p => {
    receipt = { removed: [], kept: [], deletion: { project: "original-project", id: p.id, operation: p.operation!, restored: false } };
    return receipt;
  };
  daemon.handlers["rail.restore"] = () => ({ ...receipt!, deletion: { ...receipt!.deletion!, restored: true } });
  render(() => <App app={app} reducedMotion={() => true} createEmulator={fakeEmulators().factory} prepareIdle={open => { open.showView("workstreams"); open.rail.select("chosen"); }} />);
  await screen.findByText("chosen", { selector: ".name" });
  rowOf("chosen").focus();

  if (entry === "menu") {
    fireEvent.contextMenu(rowOf("chosen"));
    await daemon.pickMenu("Remove");
  } else fireEvent.keyDown(rowOf("chosen"), { key: "Backspace", code: "Backspace", metaKey: true });

  await waitFor(() => expect(daemon.calls.filter(c => c.method === "rail.remove")).toEqual([{ method: "rail.remove", params: { id: "chosen", operation: expect.any(String) } }]));
  expect(daemon.questions).toEqual([]);
  const undo = await screen.findByRole("button", { name: "Undo" });
  daemon.handlers["rail.restore"] = () => { throw new Error("Original Home changed. Restore the Home and retry."); };
  fireEvent.click(undo);
  await screen.findByText("Original Home changed. Restore the Home and retry.");
  daemon.handlers["rail.restore"] = () => ({ ...receipt!, deletion: { ...receipt!.deletion!, restored: true } });
  fireEvent.click(undo);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
  expect(daemon.calls.filter(c => c.method === "rail.restore").map(c => c.params)).toEqual([receipt!.deletion, receipt!.deletion].map(d => ({ project: d!.project, operation: d!.operation })));
  expect(daemon.calls.filter(c => ["agent.resume", "terminal.create"].includes(c.method))).toEqual([]);
});

it.each(["process", "worktree"])("u3787a_rail_%s_requires_native_consent", async effect => {
  localStorage.clear();
  useBrowserStorage(localStorage);
  const app = createFakeApp();
  app.add("/p");
  const daemon = app.of("/p");
  daemon.handlers["rail.tree"] = () => [agent("chosen", "idle", "idle", effect === "process" ? {} : { terminal_id: null, worktree: { path: "/p/tree", branch: "work", base: "main" } })];
  render(() => <App app={app} reducedMotion={() => true} createEmulator={fakeEmulators().factory} prepareIdle={open => open.showView("workstreams")} />);
  await screen.findByText("chosen", { selector: ".name" });
  fireEvent.contextMenu(rowOf("chosen"));
  await daemon.pickMenu("Remove");
  await waitFor(() => expect(daemon.questions).toHaveLength(1));
  await answerQuestion(false);
  expect(daemon.calls.filter(c => c.method === "rail.remove")).toEqual([]);
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});
