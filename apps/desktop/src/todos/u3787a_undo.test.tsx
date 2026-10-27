import type { DeleteParams } from "@contracts/todo/DeleteParams";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
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

// SAFETY: callers select only todo.delete journal entries, whose params are DeleteParams.
const deletion = (params: unknown) => params as DeleteParams;

const draftBytes = "  未送信 é 🧭\n keep trailing spaces  ";

const openSeventh = async (connections: Map<string, ConnectedProject>) => {
  const connected = connections.get("/a")!;
  connected.drawer.open(() => <TodoHost id={7} />, "key");
  const drawer = screen.getByRole("complementary", { name: "Drawer" });
  const button = await within(drawer).findByRole<HTMLButtonElement>("button", { name: "Delete Todo" });
  const field = await within(drawer).findByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  fireEvent.input(field, { target: { value: draftBytes } });
  button.focus();

  return { connected, opening: connected.drawer.content(), button, field, drawer };
};

const unconfirmed = async () => {
  const mounted = await mount();
  const daemon = mounted.app.of("/a");
  daemon.handlers["todo.delete"] = () => { throw new Error("reply lost"); };
  daemon.handlers["todo.deletion"] = () => { throw new Error("offline"); };
  await mounted.remove("/a");
  await screen.findByRole("button", { name: "Check deletion" });

  return { ...mounted, daemon };
};

it("u3787g_a_different_drawer_delete_explains_the_unconfirmed_operation", async () => {
  const { app, connections } = await unconfirmed();
  const { connected, opening, button, field, drawer } = await openSeventh(connections);
  fireEvent.click(button);
  await within(drawer).findByText("An earlier deletion is unconfirmed. Check that deletion before trying Delete again.");
  expect(connected.drawer.content()).toBe(opening);
  expect(document.activeElement).toBe(button);
  expect(field.value).toBe(draftBytes);
  const recovery = within(drawer).getByRole<HTMLButtonElement>("button", { name: "Check deletion" });
  expect(recovery.disabled).toBe(false);
  recovery.focus();
  expect(document.activeElement).toBe(recovery);
  expect(app.of("/a").calls.filter(call => ["todo.delete", "todo.restore", "todo.comment", "todo.update"].includes(call.method))).toEqual([
    { method: "todo.delete", params: { operation: expect.any(String), ids: [5] } },
  ]);
  expect(app.of("/b").calls.filter(call => ["todo.delete", "todo.restore"].includes(call.method))).toEqual([]);
});

it("u3787g_recovery_keeps_the_original_target_and_requires_a_new_delete", async () => {
  const { app, connections, daemon } = await unconfirmed();
  const { button, drawer, field, connected, opening } = await openSeventh(connections);
  fireEvent.click(button);
  const recovery = await within(drawer).findByRole("button", { name: "Check deletion" });
  const original = deletion(daemon.calls.find(call => call.method === "todo.delete")!.params);
  daemon.handlers["todo.deletion"] = p => ({ operation: p.operation, deleted: [5], missing: [], state: "deleted" });
  fireEvent.click(recovery);
  await screen.findByRole("button", { name: "Undo" });
  expect(connected.drawer.content()).toBe(opening);
  expect(field.value).toBe(draftBytes);
  expect(daemon.calls.filter(call => call.method === "todo.deletion").map(call => call.params)).toEqual([
    { operation: expect.any(String) }, { operation: expect.any(String) },
  ]);
  expect(daemon.calls.filter(call => call.method === "todo.deletion").every(call => JSON.stringify(call.params) === JSON.stringify({ operation: original.operation }))).toBe(true);
  expect(daemon.calls.filter(call => call.method === "todo.delete")).toEqual([{ method: "todo.delete", params: original }]);
  daemon.handlers["todo.delete"] = p => ({ operation: p.operation, deleted: p.ids, missing: [], state: "deleted" });
  button.focus();
  fireEvent.click(button);
  await waitFor(() => expect(connected.drawer.content()).toBe(null));
  expect(daemon.calls.filter(call => call.method === "todo.delete")).toEqual([
    { method: "todo.delete", params: original }, { method: "todo.delete", params: { operation: expect.any(String), ids: [7] } },
  ]);
  daemon.handlers["todo.restore"] = p => ({ operation: p.operation, deleted: [7], missing: [], state: "restored" });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(daemon.calls.filter(call => call.method === "todo.restore")).toEqual([
    { method: "todo.restore", params: { operation: deletion(daemon.calls.filter(call => call.method === "todo.delete")[1]!.params).operation } },
  ]));
  expect(app.of("/b").calls.filter(call => ["todo.delete", "todo.restore", "todo.deletion"].includes(call.method))).toEqual([]);
});

const restoring = async () => {
  const mounted = await mount();
  await mounted.remove("/a");
  await waitFor(() => expect(mounted.connections.get("/a")!.drawer.content()).toBe(null));
  const opened = await openSeventh(mounted.connections);
  const daemon = mounted.app.of("/a");
  let finish!: (value: { operation: string; deleted: number[]; missing: number[]; state: "restored" }) => void;
  daemon.handlers["todo.restore"] = () => new Promise(resolve => { finish = resolve; });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(daemon.calls.filter(call => call.method === "todo.restore")).toHaveLength(1));
  opened.button.focus();
  fireEvent.click(opened.button);

  return { ...mounted, ...opened, daemon, finish };
};

it("u3787h_a_drawer_delete_explains_the_pending_restore", async () => {
  const { app, daemon, connected, opening, drawer, button, field } = await restoring();
  await within(drawer).findByText("Restoration is in progress. Wait for it to finish, then try Delete again.");
  expect(connected.drawer.content()).toBe(opening);
  expect(document.activeElement).toBe(button);
  expect(field.value).toBe(draftBytes);
  expect(daemon.calls.filter(call => ["todo.delete", "todo.restore", "todo.comment", "todo.update"].includes(call.method))).toEqual([
    { method: "todo.delete", params: { operation: expect.any(String), ids: [5] } },
    { method: "todo.restore", params: { operation: deletion(daemon.calls.find(call => call.method === "todo.delete")!.params).operation } },
  ]);
  expect(app.of("/b").calls.filter(call => ["todo.delete", "todo.restore"].includes(call.method))).toEqual([]);
});

it("u3787h_restore_completion_requires_a_new_delete", async () => {
  const { daemon, finish, connected, opening, drawer, button, field } = await restoring();
  await within(drawer).findByText("Restoration is in progress. Wait for it to finish, then try Delete again.");
  const operation = deletion(daemon.calls.find(call => call.method === "todo.delete")!.params).operation;
  finish({ operation, deleted: [5], missing: [], state: "restored" });
  await waitFor(() => expect(within(drawer).queryByText("Restoration is in progress. Wait for it to finish, then try Delete again.")).toBe(null));
  expect(connected.drawer.content()).toBe(opening);
  expect(field.value).toBe(draftBytes);
  expect(document.activeElement).toBe(button);
  expect(daemon.calls.filter(call => call.method === "todo.delete")).toEqual([
    { method: "todo.delete", params: { operation, ids: [5] } },
  ]);
  fireEvent.click(button);
  await waitFor(() => expect(connected.drawer.content()).toBe(null));
  const undo = await screen.findByRole("button", { name: "Undo" });
  expect(daemon.calls.filter(call => call.method === "todo.delete")).toEqual([
    { method: "todo.delete", params: { operation, ids: [5] } },
    { method: "todo.delete", params: { operation: expect.any(String), ids: [7] } },
  ]);
  fireEvent.click(undo);
  await waitFor(() => expect(daemon.calls.filter(call => call.method === "todo.restore")).toEqual([
    { method: "todo.restore", params: { operation } },
    { method: "todo.restore", params: { operation: deletion(daemon.calls.filter(call => call.method === "todo.delete")[1]!.params).operation } },
  ]));
});
