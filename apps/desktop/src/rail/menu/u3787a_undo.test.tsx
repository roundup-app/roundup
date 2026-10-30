import { openProjectPage } from "../../testing/menuProbe";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../../App";
import { createFakeApp } from "../../testing/fakeApp";
import { agent, workstream } from "../../testing/nodes";
import { rowOf } from "../railFixture";
import { fakeEmulators } from "../../terminal/paneHarness";
import { useBrowserStorage } from "../../state/storage";
import { stubDialogLayout, answerQuestion } from "../../shelf/bulkQuestionHarness";
import type { ConnectedProject } from "../../state/connectedProject";
import type { Removal } from "@contracts/agent/Removal";

stubDialogLayout();

afterEach(cleanup);

it.each(["menu", "key", "unknown", "pending"].flatMap(entry => ["agent", "workstream"].map(kind => [entry, kind])))("u3787a_rail_%s_deletes_without_question_and_restores_retained_identity_%s", async (entry, kind) => {
  localStorage.clear();
  useBrowserStorage(localStorage);
  const app = createFakeApp();
  let connected: ConnectedProject | undefined;
  const nodes = [kind === "workstream" ? workstream("chosen", { terminal_id: null }) : agent("chosen", "idle", "idle", { terminal_id: null }), agent("other", "idle", "idle", { terminal_id: null })];
  app.add("/p");
  const daemon = app.of("/p");
  daemon.handlers["rail.tree"] = () => nodes;
  let receipt: Removal | null = null;
  let finish: ((value: Removal) => void) | undefined;
  let readable = entry !== "unknown";
  daemon.handlers["rail.deletion"] = () => {
    if (!readable) throw new Error("Receipt lookup unavailable. Check deletion to recover.");

    return receipt;
  };

  daemon.handlers["rail.remove"] = p => {
    receipt = { removed: [], kept: [], deletion: { project: "original-project", id: p.id, operation: p.operation!, restored: false } };

    if (!readable) throw new Error("Deletion reply lost. Check deletion to recover.");

    return entry === "pending" ? new Promise<Removal>(resolve => { finish = resolve; }) : receipt;
  };

  daemon.handlers["rail.restore"] = () => ({ ...receipt!, deletion: { ...receipt!.deletion!, restored: true } });
  render(() => <App clock={() => 0} app={app} reducedMotion={() => true} createEmulator={fakeEmulators().factory} prepareIdle={open => { connected = open; open.showView("workstreams"); }} />);
  await screen.findByText("chosen", { selector: ".name" });
  connected!.rail.select("chosen");
  rowOf("chosen").focus();

  if (entry !== "key") {
    fireEvent.contextMenu(rowOf("chosen"));
    await daemon.pickMenu("Remove");
  } else fireEvent.keyDown(rowOf("chosen"), { key: "Backspace", code: "Backspace", metaKey: true });

  await waitFor(() => expect(daemon.calls.filter(c => c.method === "rail.remove")).toEqual([{ method: "rail.remove", params: { id: "chosen", operation: expect.any(String) } }]));
  expect(daemon.questions).toEqual([]);

  if (entry === "pending") {
    fireEvent.keyDown(rowOf("chosen"), { key: "Backspace", code: "Backspace", metaKey: true });
    expect([screen.queryByText("Deleted chosen")]).toEqual([null]);
    finish!(receipt!);
  }

  if (!readable) {
    const check = await screen.findByRole("button", { name: "Check deletion" });
    expect([screen.queryByText("Deleted chosen")]).toEqual([null]);
    readable = true;
    fireEvent.click(check);
  }

  await waitFor(() => expect(connected!.drafts.todoUndo.available("rail")).toBe(true));
  expect([screen.queryByText("Deleted chosen")]).toEqual([null]);
  expect(connected!.drafts.todoUndo.available("rail")).toBe(true);
  expect(connected!.drafts.todoUndo.available("shelf")).toBe(false);
  // Settle the event-driven refresh before either Undo entry point.
  daemon.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
  await waitFor(() => expect(daemon.calls.filter(c => c.method === "rail.tree").length).toBeGreaterThan(1));

  if (entry === "menu" || entry === "key") {
    if (entry === "menu") openProjectPage("action:chord:⌘Z", "/p");
    else fireEvent.keyDown(document.activeElement ?? document.body, { key: "z", code: "KeyZ", metaKey: true });
    await waitFor(() => expect(daemon.calls.filter(c => c.method === "rail.restore")).toHaveLength(1));
    await waitFor(() => expect([screen.queryByRole("button", { name: "Undo" })]).toEqual([null]));
    expect(screen.queryByRole("alert")).toBeNull();

    return;
  }

  daemon.handlers["rail.restore"] = () => { throw new Error("Original Home changed. Restore the Home and retry."); };

  fireEvent.keyDown(document.activeElement ?? document.body, { key: "z", code: "KeyZ", metaKey: true });
  await screen.findByText("Original Home changed. Restore the Home and retry.");
  daemon.handlers["rail.restore"] = () => ({ ...receipt!, deletion: { ...receipt!.deletion!, restored: true } });
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "z", code: "KeyZ", metaKey: true });
  await waitFor(() => expect([screen.queryByText("Deleted chosen")]).toEqual([null]));
  expect(daemon.calls.filter(c => c.method === "rail.restore").map(c => c.params)).toEqual([receipt!.deletion, receipt!.deletion].map(d => ({ project: d!.project, operation: d!.operation })));
  expect(daemon.calls.filter(c => c.method === "rail.remove")).toHaveLength(1);
  expect(daemon.calls.filter(c => ["agent.resume", "terminal.create"].includes(c.method))).toEqual([]);
});

it.each(["process", "worktree", "cascade"])("u3787a_rail_%s_requires_native_consent", async effect => {
  localStorage.clear();
  useBrowserStorage(localStorage);
  const app = createFakeApp();
  app.add("/p");
  const daemon = app.of("/p");
  daemon.handlers["rail.tree"] = () => effect === "cascade" ? [workstream("chosen"), workstream("child", { parent: "chosen", worktree: { path: "/p/tree", branch: "work", base: "main" } })] : [agent("chosen", "idle", "idle", effect === "process" ? {} : { terminal_id: null, worktree: { path: "/p/tree", branch: "work", base: "main" } })];
  render(() => <App clock={() => 0} app={app} reducedMotion={() => true} createEmulator={fakeEmulators().factory} prepareIdle={open => open.showView("workstreams")} />);
  await screen.findByText("chosen", { selector: ".name" });
  fireEvent.contextMenu(rowOf("chosen"));
  await daemon.pickMenu("Remove");
  await waitFor(() => expect(daemon.questions).toHaveLength(1));
  await answerQuestion(false);
  expect(daemon.calls.filter(c => c.method === "rail.remove")).toEqual([]);
  expect([screen.queryByText("Deleted chosen")]).toEqual([null]);
});
