import { padHandlers } from "../testing/stores";
import { padOf, AGENT, openPad } from "../pads/padsFixture";
import { USER } from "../testing/nodes";
import { showShelfTab } from "../testing/shelfTabs";
import { RpcError } from "../app/seam";
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

const mount = async (done = false) => {
  localStorage.clear();
  useBrowserStorage(localStorage);
  const app = createFakeApp();
  const connections = new Map<string, ConnectedProject>();

  for (const path of ["/a", "/b"]) {
    app.add(path);
    const daemon = app.of(path);
    Object.assign(daemon.handlers, padHandlers({ pads: [padOf("first", AGENT, "original"), padOf("second", USER, "other")], history: [] }, data => daemon.emit({ actor: USER, ...data })));
    daemon.handlers["todo.list"] = () => [todo(5, { done, title: "same" }), todo(7, { done, title: "same" })];
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
    const { app } = await mount(entry === "clear-done");
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

const showPads = async () => {
  showShelfTab("Pads");
  await waitFor(() => {
    const groups = document.querySelectorAll('.pads-tab [data-shelf-group]');

    if (!groups.length) throw new Error("Pad groups are loading");

    for (const control of document.querySelectorAll<HTMLElement>('.pads-tab [data-shelf-group] [data-part="branch-control"]')) if (control.closest('[role="treeitem"]')?.getAttribute("aria-expanded") === "false") fireEvent.click(control);
  });
};

for (const entry of ["selection", "single", "drawer"] as const) {
  it(`u3787a_success_and_partial_failure_offer_only_acknowledged_undo_pads_${entry}`, async () => {
    const { app } = await mount();
    const daemon = app.of("/a");
    await showEverythingInApp();
    await showPads();
    const first = await screen.findByRole("button", { name: "first" });

    if (entry === "selection") {
      const remove = daemon.handlers["pad.delete"]!;
      daemon.handlers["pad.delete"] = p => { if (p.name === "second") throw new RpcError(-32002, "permission refused");

 return remove(p)!; };

      fireEvent.click(first, { metaKey: true });
      fireEvent.click(screen.getByRole("button", { name: "second" }), { metaKey: true });
      fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
      await screen.findByText("Could not delete second: permission refused");
      expect(screen.getByRole("button", { name: "second" }).getAttribute("aria-pressed")).toBe("true");
    } else if (entry === "single") { first.focus(); fireEvent.keyDown(first, { key: "d", code: "KeyD" }); }
    else {
      fireEvent.keyDown(first, { key: "Enter" });
      fireEvent.click(await within(screen.getByRole("complementary", { name: "Drawer" })).findByRole("button", { name: "Delete" }));
    }

    const button = await screen.findByRole("button", { name: "Undo" });
    expect([questionProbe.shown]).toEqual([null]);
    expect(daemon.calls.filter(c => c.method === "pad.delete").map(c => c.params)).toEqual((entry === "selection" ? ["first", "second"] : ["first"]).map(name => ({ name, expectedIncarnation: `fixture-${name}`, operation: expect.any(String) })));
    fireEvent.click(button);
    await screen.findByRole("button", { name: "first" });
    await waitFor(() => expect(daemon.calls.filter(c => c.method === "pad.restore").length).toBe(1));
    expect((await daemon.rpc("pad.read", { name: "first" }))).toEqual(padOf("first", AGENT, "original"));
    expect(daemon.calls.filter(c => ["agent.spawn", "terminal.spawn", "pad.create"].includes(c.method))).toEqual([]);
  });
}

it("u3787a_undo_failure_is_retryable_without_rerunning_restored_pad_members", async () => {
  const { app } = await mount();
  const daemon = app.of("/a");
  await showEverythingInApp();
  await showPads();
  fireEvent.click(await screen.findByRole("button", { name: "first" }), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "second" }), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
  const button = await screen.findByRole("button", { name: "Undo" });
  const restore = daemon.handlers["pad.restore"]!;
  let refuse = true;
  let calls = 0;
  daemon.handlers["pad.restore"] = p => { calls++;

 if (calls === 2 && refuse) throw new RpcError(-32003, "name conflict");

 return restore(p)!; };

  fireEvent.click(button);
  await screen.findByText("second: name conflict");
  await daemon.rpc("pad.setOwner", { name: "first", owner: USER });
  await daemon.rpc("pad.write", { name: "first", text: "edited after restore" });
  refuse = false;
  fireEvent.click(button);
  await waitFor(() => expect([screen.queryByRole("button", { name: "Undo" })]).toEqual([null]));
  expect(calls).toBe(3);
  expect((await daemon.rpc("pad.read", { name: "first" })).text).toBe("edited after restore");
});

it("u3787a_unknown_delete_reconciles_before_retry_pads", async () => {
  const { app } = await mount();
  const daemon = app.of("/a");
  const remove = daemon.handlers["pad.delete"]!;
  const read = daemon.handlers["pad.getDeletion"]!;
  daemon.handlers["pad.delete"] = async p => { await remove(p); throw new Error("reply lost"); };

  daemon.handlers["pad.getDeletion"] = () => { throw new Error("offline"); };

  await showEverythingInApp();
  await showPads();
  const row = await screen.findByRole("button", { name: "first" });
  row.focus();
  fireEvent.keyDown(row, { key: "d", code: "KeyD" });
  const check = await screen.findByRole("button", { name: "Check deletion" });
  expect([screen.queryByRole("button", { name: "Undo" })]).toEqual([null]);
  daemon.handlers["pad.getDeletion"] = read;
  fireEvent.click(check);
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await screen.findByRole("button", { name: "first" });
  expect(daemon.calls.filter(call => call.method === "pad.delete").map(call => call.params)).toEqual([
    { name: "first", expectedIncarnation: "fixture-first", operation: expect.any(String) },
  ]);
});

it("u3787a_delete_has_no_question_and_freezes_targets_pads_pending", async () => {
  const { app } = await mount();
  const daemon = app.of("/a");
  const remove = daemon.handlers["pad.delete"]!;
  let release!: () => void;
  daemon.handlers["pad.delete"] = async p => { await new Promise<void>(resolve => { release = resolve; });

 return remove(p)!; };

  await showEverythingInApp();
  await showPads();
  const row = await screen.findByRole("button", { name: "first" });
  row.focus();
  fireEvent.keyDown(row, { key: "d", code: "KeyD" });
  fireEvent.keyDown(row, { key: "d", code: "KeyD" });
  await daemon.rpc("pad.create", { name: "arrival", text: "new" });
  await screen.findByRole("button", { name: "arrival" });
  release();
  await screen.findByRole("button", { name: "Undo" });
  expect(daemon.calls.filter(call => call.method === "pad.delete").map(call => call.params)).toEqual([
    { name: "first", expectedIncarnation: "fixture-first", operation: expect.any(String) },
  ]);
  expect((await daemon.rpc("pad.read", { name: "arrival" })).text).toBe("new");
});

for (const entry of ["selection", "clear-done"] as const) {
  it(`u3787a_success_and_partial_failure_offer_only_acknowledged_undo_todos_${entry}`, async () => {
    const { app } = await mount(entry === "clear-done");
    const daemon = app.of("/a");
    daemon.handlers["todo.delete"] = p => ({ operation: p.operation, deleted: [5], missing: [7], state: "deleted" });
    await showEverythingInApp();

    if (entry === "clear-done") fireEvent.click(await screen.findByRole("button", { name: "Clear done" }));
    else {
      fireEvent.click(await screen.findByRole("button", { name: /#5 / }), { metaKey: true });
      fireEvent.click(screen.getByRole("button", { name: /#7 / }), { metaKey: true });
      fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    }

    await screen.findByText("Could not delete same #7: The chosen Todo is no longer available. Refresh to check again.");
    expect(screen.getByRole("button", { name: /#7 / }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(daemon.calls.filter(c => c.method === "todo.restore").map(c => c.params)).toEqual([{ operation: expect.any(String) }]));
    expect(daemon.calls.filter(c => c.method === "todo.delete").map(c => c.params)).toEqual([{ ids: [5, 7], operation: expect.any(String) }]);
  });
}

it("u3787a_pad_deletion_and_undo_preserve_the_exact_unsubmitted_draft", async () => {
  const { connections } = await mount();
  await showEverythingInApp();
  await showPads();
  const field = await openPad("second");
  const text = "  unfinished é 🧭\n\nlast  ";
  fireEvent.input(field, { target: { value: text } });
  const connected = connections.get("/a")!;
  const retained = connected.drafts.list();
  expect(retained.map(draft => draft.value.source)).toEqual([expect.stringContaining("unfinished")]);
  fireEvent.click(within(screen.getByRole("complementary", { name: "Drawer" })).getByRole("button", { name: "Delete" }));
  const undo = await screen.findByRole("button", { name: "Undo" });
  expect(connected.drafts.list()).toEqual(retained);
  fireEvent.click(undo);
  await screen.findByRole("button", { name: "second" });
  expect(connected.drafts.list()).toEqual(retained);
});
