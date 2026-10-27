import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { showEverythingInApp } from "../testing/showEverything";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { TodoHost } from "./TodoDrawer";
import { todo } from "./testHarness";
import type { ConnectedProject } from "../state/connectedProject";
import { questionProbe } from "../testing/menuProbe";
import { stubDialogLayout } from "../shelf/bulkQuestionHarness";
import { useBrowserStorage } from "../state/storage";

stubDialogLayout();

afterEach(cleanup);

const mount = async () => {
  localStorage.clear();
  useBrowserStorage(localStorage);
  const app = createFakeApp();
  const connections = new Map<string, ConnectedProject>();

  for (const path of ["/a", "/b"]) {
    app.add(path);
    const daemon = app.of(path);
    daemon.handlers["todo.list"] = () => [todo(5), todo(7)];
    daemon.handlers["todo.getHistory"] = () => ({ changes: [], unread: null });
    daemon.handlers["todo.comments"] = () => [];
    daemon.handlers["todo.refs"] = () => [];
    daemon.handlers["todo.delete"] = p => ({ operation: p.operation, deleted: p.ids, missing: [], state: "deleted" });
    daemon.handlers["todo.restore"] = p => ({ operation: p.operation, deleted: [5], missing: [], state: "restored" });
  }

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} prepareIdle={open => { connections.set(open.project.path, open); open.showView("workstreams"); }} />);
  await waitFor(() => expect(connections.has("/b")).toBe(true));
  fireEvent.click(screen.getByRole("tab", { name: /^a/ }));
  await waitFor(() => expect(connections.size).toBe(2));

  const remove = async (path: string, id = 5) => {
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${path.slice(1)}`) }));
    await screen.findByRole("tabpanel", { name: path.slice(1) });
    connections.get(path)!.drawer.open(() => <TodoHost id={id} />, "key");
    const button = await within(screen.getByRole("complementary", { name: "Drawer" })).findByRole<HTMLButtonElement>("button", { name: "Delete Todo" });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);

    return button;
  };

  return { app, connections, remove };
};

it("u3787a_delete_has_no_question_and_freezes_targets", async () => {
  const { app, remove, connections } = await mount();
  const announcements = screen.getAllByRole("status");
  let finish!: (value: { operation: string; deleted: number[]; missing: number[]; state: "deleted" }) => void;
  app.of("/a").handlers["todo.delete"] = () => new Promise(resolve => { finish = resolve; });
  const button = await remove("/a");
  fireEvent.click(button);
  const calls = app.of("/a").calls.filter(c => c.method === "todo.delete");
  expect(calls).toEqual([{ method: "todo.delete", params: { operation: expect.any(String), ids: [5] } }]);
  expect([questionProbe.shown]).toEqual([null]);
  expect([screen.queryByRole("button", { name: "Undo" })]).toEqual([null]);
  // SAFETY: the preceding exact call assertion checks this captured deletion payload.
  const operation = (calls[0]!.params as { operation: string }).operation;
  finish({ operation, deleted: [5], missing: [], state: "deleted" });
  await screen.findByRole("button", { name: "Undo" });
  expect([connections.get("/a")!.drawer.content()]).toEqual([null]);
  const undo = screen.getByRole("button", { name: "Undo" });
  expect(announcements).toContain(undo.closest('[role="status"]'));
  fireEvent.click(undo);
  fireEvent.click(undo);
  await waitFor(() => expect(app.of("/a").calls.filter(c => c.method === "todo.restore")).toEqual([{ method: "todo.restore", params: { operation } }]));
});

const undoKey = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "z", code: "KeyZ", metaKey: true });

it("u3787a_undo_stays_with_its_project", async () => {
  const { app, remove, connections } = await mount();

  for (const path of ["/a", "/b"]) {
    await remove(path, 5);
    await waitFor(() => expect(app.of(path).calls.filter(call => call.method === "todo.delete").length).toBe(1));
    await waitFor(() => expect([connections.get(path)!.drawer.content()]).toEqual([null]));
    await remove(path, 7);
    await waitFor(() => expect(app.of(path).calls.filter(call => call.method === "todo.delete").length).toBe(2));
    await waitFor(() => expect([connections.get(path)!.drawer.content()]).toEqual([null]));
  }

  // Only the active Project offers feedback; selecting A restores its own action.
  fireEvent.click(screen.getByRole("tab", { name: /^a/ }));
  await screen.findByRole("tabpanel", { name: "a" });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(app.of("/a").calls.filter(call => call.method === "todo.restore").length).toBe(1));
  fireEvent.click(screen.getByRole("tab", { name: /^b/ }));
  await screen.findByRole("tabpanel", { name: "b" });
  document.body.focus();
  undoKey();
  await waitFor(() => expect(app.of("/b").calls.filter(call => call.method === "todo.restore").length).toBe(1));

  // Dismissing feedback and closing the original tab consume no receipt.
  for (const button of screen.queryAllByRole("button", { name: "Dismiss" })) fireEvent.click(button);
  fireEvent.pointerEnter(screen.getByRole("tab", { name: /^a/ }).parentElement!);
  fireEvent.click(screen.getByRole("button", { name: "Close a" }));
  await waitFor(() => expect(app.closed).toContain("/a"));
  app.nativeOpen({ kind: "project", path: "/a" });
  await screen.findByRole("tab", { name: /^a/ });
  document.body.focus();
  undoKey();
  await waitFor(() => expect(app.of("/a").calls.filter(call => call.method === "todo.restore").length).toBe(2));
  undoKey();
  await new Promise<void>(resolve => queueMicrotask(resolve));

  for (const path of ["/a", "/b"]) {
    // SAFETY: these calls are filtered to todo.delete and generated handlers accept DeleteParams.
    const deleted = app.of(path).calls.filter(call => call.method === "todo.delete").map(c => c.params as { operation: string; ids: number[] });
    const restored = app.of(path).calls.filter(call => call.method === "todo.restore").map(c => c.params);
    expect(deleted.map(p => p.ids)).toEqual([[5], [7]]);
    expect(restored).toEqual((path === "/a" ? [deleted[1], deleted[0]] : [deleted[1]]).map(p => ({ operation: p!.operation })));
  }
});

it("u3787a_editor_and_terminal_keep_undo", async () => {
  const { app, remove } = await mount();
  await remove("/a");
  await screen.findByRole("button", { name: "Undo" });

  for (const markup of ['<input>', '<textarea></textarea>', '<div contenteditable="true" tabindex="0"></div>', '<div class="xterm"><textarea></textarea></div>', '<div role="textbox" tabindex="0"></div>']) {
    const root = document.createElement("div");
    root.innerHTML = markup;
    document.body.append(root);
    const editor = root.querySelector<HTMLElement>("textarea,input,[tabindex]")!;
    editor.focus();
    expect(undoKey()).toBe(true);
    expect(app.of("/a").calls.filter(call => call.method === "todo.restore").length).toBe(0);
    root.remove();
  }

  undoKey();
  await waitFor(() => expect(app.of("/a").calls.filter(call => call.method === "todo.restore").length).toBe(1));
});

it("u3787a_unknown_delete_reconciles_before_retry", async () => {
  const { app, remove } = await mount();
  const daemon = app.of("/a");
  daemon.handlers["todo.delete"] = () => { throw new Error("reply lost"); };

  daemon.handlers["todo.deletion"] = () => { throw new Error("offline"); };

  await remove("/a");
  await screen.findByRole("button", { name: "Check deletion" });
  expect([screen.queryByRole("button", { name: "Undo" })]).toEqual([null]);
  // SAFETY: the journal is filtered to todo.delete, whose generated params contain operation.
  const original = app.of("/a").calls.filter(call => call.method === "todo.delete")[0]!.params as { operation: string };
  daemon.handlers["todo.deletion"] = () => ({ ...original, deleted: [5], missing: [], state: "deleted" });
  fireEvent.click(screen.getByRole("button", { name: "Check deletion" }));
  await screen.findByRole("button", { name: "Undo" });
  expect(app.of("/a").calls.filter(call => call.method === "todo.delete").length).toBe(1);
  expect(app.of("/a").calls.filter(call => call.method === "todo.deletion").map(c => c.params)).toEqual([{ operation: original.operation }, { operation: original.operation }]);
});

it("u3787a_undo_failure_is_retryable", async () => {
  const { app, remove } = await mount();
  await remove("/a");
  const button = await screen.findByRole("button", { name: "Undo" });
  app.of("/a").handlers["todo.restore"] = () => { throw new Error("Original Home is unavailable. Restore the Home and retry."); };

  fireEvent.click(button);
  await screen.findByText("Original Home is unavailable. Restore the Home and retry.");
  expect(button.hasAttribute("disabled")).toBe(false);
  app.of("/a").handlers["todo.restore"] = p => ({ operation: p.operation, deleted: [5], missing: [], state: "restored" });
  fireEvent.click(button);
  await waitFor(() => expect([screen.queryByRole("button", { name: "Undo" })]).toEqual([null]));
  // SAFETY: the source call is filtered to todo.delete and its generated params contain operation.
  expect(app.of("/a").calls.filter(call => call.method === "todo.restore").map(c => c.params)).toEqual(Array(2).fill({ operation: (app.of("/a").calls.filter(call => call.method === "todo.delete")[0]!.params as { operation: string }).operation }));
  expect(app.of("/a").calls.filter(c => ["todo.create", "agent.spawn", "terminal.spawn"].includes(c.method))).toEqual([]);
});

it("u3787a_unknown_restore_consumes_only_the_reconciled_receipt", async () => {
  const { app, remove } = await mount();
  await remove("/a");
  const button = await screen.findByRole("button", { name: "Undo" });
  let restored = false;
  // SAFETY: the source call is filtered to todo.delete and its generated params contain operation.
  const params = app.of("/a").calls.filter(call => call.method === "todo.delete")[0]!.params as { operation: string };
  app.of("/a").handlers["todo.deletion"] = () => ({ operation: params.operation, deleted: [5], missing: [], state: restored ? "restored" : "deleted" });
  app.of("/a").handlers["todo.restore"] = () => { restored = true; throw new Error("reply lost after restore"); };

  fireEvent.click(button);
  await waitFor(() => expect([screen.queryByRole("button", { name: "Undo" })]).toEqual([null]));
  undoKey();
  expect(app.of("/a").calls.filter(call => call.method === "todo.restore").map(c => c.params)).toEqual([{ operation: params.operation }]);
  expect(app.of("/a").calls.filter(call => call.method === "todo.deletion").map(c => c.params)).toEqual([{ operation: params.operation }, { operation: params.operation }]);
});

it("u3787a_refused_delete_keeps_the_previous_success_available", async () => {
  const { app, remove, connections } = await mount();
  await remove("/a", 5);
  await waitFor(() => expect([connections.get("/a")!.drawer.content()]).toEqual([null]));
  const { RpcError } = await import("../app/seam");
  app.of("/a").handlers["todo.delete"] = () => { throw new RpcError(-32002, "Deletion refused. Check access."); };

  await remove("/a", 7);
  await screen.findAllByText("Deletion refused. Check access.");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(app.of("/a").calls.filter(c => c.method === "todo.restore").map(c => c.params)).toEqual([
    { operation: expect.any(String) },
  ]));
  expect(app.of("/a").calls.filter(c => c.method === "todo.delete").map(c => c.params)).toEqual([
    { ids: [5], operation: expect.any(String) }, { ids: [7], operation: expect.any(String) },
  ]);
});

for (const entry of ["selection", "single", "clear-done"] as const) {
  it(`u3787a_delete_has_no_question_and_freezes_targets_${entry}`, async () => {
    const { app } = await mount();
    const daemon = app.of("/a");
    daemon.handlers["todo.list"] = () => [todo(5, { done: entry === "clear-done" }), todo(7, { done: entry === "clear-done" })];
    await showEverythingInApp();
    if (entry === "clear-done") fireEvent.click(await screen.findByRole("button", { name: "Clear done" }));
    else {
      const first = await screen.findByRole("button", { name: /#5 / });
      if (entry === "selection") {
        fireEvent.click(first, { metaKey: true });
        fireEvent.click(screen.getByRole("button", { name: /#7 / }), { metaKey: true });
        fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
      } else { first.focus(); fireEvent.keyDown(first, { key: "d", code: "KeyD" }); }
    }
    await waitFor(() => expect(daemon.calls.filter(c => c.method === "todo.delete").map(c => c.params)).toEqual([
      { operation: expect.any(String), ids: entry === "single" ? [5] : [5, 7] },
    ]));
    expect([questionProbe.shown]).toEqual([null]);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(daemon.calls.filter(c => c.method === "todo.restore").map(c => c.params)).toEqual([{ operation: expect.any(String) }]));
  });
}
