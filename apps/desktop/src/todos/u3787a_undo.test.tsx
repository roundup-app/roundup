import { padHandlers } from "../testing/stores";
import { padOf, AGENT, openPad } from "../pads/padsFixture";
import { USER } from "../testing/nodes";
import { showShelfTab } from "../testing/shelfTabs";
import { RpcError } from "../app/seam";
import type { DeleteParams } from "@contracts/todo/DeleteParams";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { showEverythingInApp } from "../testing/showEverything";
import { App } from "../App";
import { createFakeApp, type FakeApp } from "../testing/fakeApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { TodoHost } from "./TodoDrawer";
import { todo } from "./testHarness";
import type { ConnectedProject } from "../state/connectedProject";
import { openProjectPage, projectMenu, questionProbe } from "../testing/menuProbe";
import { stubDialogLayout } from "../shelf/bulkQuestionHarness";
import { useBrowserStorage } from "../state/storage";
import { historyRegion } from "../keys/focus";

stubDialogLayout();

afterEach(cleanup);

let histories: Map<string, ConnectedProject>;

const mount = async (done = false) => {
  localStorage.clear();
  document.body.tabIndex = -1;
  useBrowserStorage(localStorage);
  const app = createFakeApp();
  const connections = new Map<string, ConnectedProject>();
  histories = connections;

  for (const path of ["/a", "/b"]) {
    app.add(path);
    const daemon = app.of(path);
    Object.assign(daemon.handlers, padHandlers({ pads: [padOf("first", AGENT, "original"), padOf("second", USER, "other")], history: [] }, data => daemon.emit({ actor: USER, ...data })));
    daemon.handlers["todo.list"] = () => [todo(5, { done, title: "same" }), todo(7, { done, title: "same" })];
    daemon.handlers["todo.getHistory"] = () => ({ changes: [], unread: null });
    daemon.handlers["todo.comments"] = () => [];
    daemon.handlers["todo.refs"] = () => [];
    daemon.handlers["todo.delete"] = p => ({ operation: p.operation, deleted: p.ids, missing: [], state: "deleted" });
    daemon.handlers["todo.restore"] = p => ({ operation: p.operation, deleted: [5], missing: [], state: "restored", restoration: "restoration-5" });
  }

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} prepareIdle={open => { connections.set(open.project.path, open); open.showView("workstreams"); }} />);
  await waitFor(() => expect(connections.has("/b")).toBe(true));
  fireEvent.click(document.querySelector<HTMLElement>('.project-tab[data-path="/a"] [role="tab"]')!);
  await waitFor(() => expect(connections.size).toBe(2));

  const remove = async (path: string, id = 5) => {
    fireEvent.click(document.querySelector<HTMLElement>(`.project-tab[data-path="${path}"] [role="tab"]`)!);
    await waitFor(() => expect(projectMenu.path).toBe(path));
    connections.get(path)!.drawer.open(() => <TodoHost id={id} />, "key");
    const button = await within(screen.getByRole("complementary", { name: "Drawer" })).findByRole<HTMLButtonElement>("button", { name: "More actions" });

    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));

    return button;
  };

  return { app, connections, remove };
};

it.each(["key", "menu"])("u3787a_delete_has_no_question_and_freezes_targets_u3787b_%s", async source => {
  const { app, remove, connections } = await mount();
  let finish!: (value: { operation: string; deleted: number[]; missing: number[]; state: "deleted" }) => void;
  app.of("/a").handlers["todo.delete"] = () => new Promise(resolve => { finish = resolve; });
  const button = await remove("/a");
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));
  const calls = app.of("/a").calls.filter(c => c.method === "todo.delete");
  expect(calls).toEqual([{ method: "todo.delete", params: { operation: expect.any(String), ids: [5] } }]);
  expect([questionProbe.shown]).toEqual([null]);
  expect([screen.queryByText(DELETED)]).toEqual([null]);
  // SAFETY: the preceding exact call assertion checks this captured deletion payload.
  const operation = (calls[0]!.params as { operation: string }).operation;
  finish({ operation, deleted: [5], missing: [], state: "deleted" });
  await acknowledged();
  await waitFor(() => expect([connections.get("/a")!.drawer.content()]).toEqual([null]));
  expect(connections.get("/a")!.drafts.todoUndo.available("todo:5")).toBe(true);
  expect(connections.get("/a")!.drafts.todoUndo.available("todo:7")).toBe(false);
  expect([...document.querySelectorAll("button")].filter(button => button.textContent === "Undo")).toEqual([]);

  if (source === "menu") {
    document.body.focus();
    await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:⌘Z")?.enabled).toBe(true));
    expect(projectMenu.items.find(item => item.id === "action:chord:⌘Z")?.label).toBe("Undo Delete Todo");
    openProjectPage("action:chord:⌘Z", "/a");
    openProjectPage("action:chord:⌘Z", "/a");
  } else {
    pressUndo();
    pressUndo();
  }

  await waitFor(() => expect(app.of("/a").calls.filter(c => c.method === "todo.restore")).toEqual([{ method: "todo.restore", params: { operation } }]));
});

const DELETED = /^Deleted \d/;

const acknowledged = async () => {
  await waitFor(() => {
    expect([...histories.values()].some(open => open.drafts.todoUndo.available() && !open.drafts.todoUndo.pending())).toBe(true);
    expect(screen.queryByText(DELETED)).toBeNull();
  });
  await new Promise<void>(resolve => queueMicrotask(resolve));
};

const pressUndo = () => {
  const history = histories.get(projectMenu.path ?? "/a")?.drafts.todoUndo;

  const target = history?.available("rail") ? document.querySelector<HTMLElement>(".rail-tree")
    : history?.available("shelf") ? document.querySelector<HTMLElement>('.shelf-tab[aria-selected="true"]')
    : document.activeElement instanceof HTMLElement && history?.available(historyRegion(document.activeElement)) ? document.activeElement : document.body;

  if (target) { target.tabIndex = -1; target.focus(); }

  undoKey();
};

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
  fireEvent.click(document.querySelector<HTMLElement>('.project-tab[data-path="/a"] [role="tab"]')!);
  await waitFor(() => expect(projectMenu.path).toBe("/a"));
  pressUndo();
  await waitFor(() => expect(app.of("/a").calls.filter(call => call.method === "todo.restore").length).toBe(1));
  fireEvent.click(document.querySelector<HTMLElement>('.project-tab[data-path="/b"] [role="tab"]')!);
  await waitFor(() => expect(projectMenu.path).toBe("/b"));
  document.body.focus();
  undoKey();
  await waitFor(() => expect(app.of("/b").calls.filter(call => call.method === "todo.restore").length).toBe(1));

  // Closing the original tab consumes no receipt.
  fireEvent.pointerEnter(document.querySelector<HTMLElement>('.project-tab[data-path="/a"] [role="tab"]')!.parentElement!);
  fireEvent.click(screen.getByLabelText("Close a"));
  await waitFor(() => expect(app.closed).toContain("/a"));
  app.nativeOpen({ kind: "project", path: "/a" });
  await waitFor(() => expect(projectMenu.path).toBe("/a"));
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
  await acknowledged();

  for (const markup of ['<input>', '<textarea></textarea>', '<div contenteditable="true" tabindex="0"></div>', '<div class="xterm"><textarea></textarea></div>', '<div role="textbox" tabindex="0"></div>']) {
    const root = document.createElement("div");
    root.innerHTML = markup;
    document.body.append(root);
    const editor = root.querySelector<HTMLElement>("textarea,input,[tabindex]")!;
    editor.focus();

    for (const shiftKey of [false, true]) {
      expect(fireEvent.keyDown(editor, { key: "z", code: "KeyZ", metaKey: true, shiftKey })).toBe(true);
    }

    await waitFor(() => expect(projectMenu.items.some(item => item.id === "action:chord:⌘Z" && item.enabled)).toBe(false));
    openProjectPage("action:chord:⌘Z", "/a");
    expect(app.of("/a").calls.filter(call => call.method === "todo.restore").length).toBe(0);
    root.remove();
  }

  undoKey();
  await waitFor(() => expect(app.of("/a").calls.filter(call => call.method === "todo.restore").length).toBe(1));
});

it("u3787a_undo_failure_is_retryable", async () => {
  const { app, remove } = await mount();
  await remove("/a");
  await acknowledged();
  app.of("/a").handlers["todo.restore"] = () => { throw new Error("Original Home is unavailable. Restore the Home and retry."); };

  pressUndo();
  await screen.findByText("Original Home is unavailable. Restore the Home and retry.");
  app.of("/a").handlers["todo.restore"] = p => ({ operation: p.operation, deleted: [5], missing: [], state: "restored", restoration: "restoration-5" });
  pressUndo();
  await waitFor(() => expect([...histories.values()].every(open => !open.drafts.todoUndo.pending())).toBe(true));
  // SAFETY: the source call is filtered to todo.delete and its generated params contain operation.
  expect(app.of("/a").calls.filter(call => call.method === "todo.restore").map(c => c.params)).toEqual(Array(2).fill({ operation: (app.of("/a").calls.filter(call => call.method === "todo.delete")[0]!.params as { operation: string }).operation }));
  expect(app.of("/a").calls.filter(c => ["todo.create", "agent.spawn", "terminal.spawn"].includes(c.method))).toEqual([]);
});

it("u3787a_bulk_delete_returns_focus_to_the_first_remaining_row", async () => {
  const { app } = await mount();
  const daemon = app.of("/a");
  daemon.handlers["todo.list"] = () => [todo(5), todo(7), todo(9)];
  const remove = daemon.handlers["todo.delete"]!;
  daemon.handlers["todo.delete"] = async params => {
    const result = await remove(params);
    daemon.handlers["todo.list"] = () => [todo(9)];

    return result;
  };

  await showEverythingInApp();
  fireEvent.click(await screen.findByLabelText(/^(?:Idle|Blocked|Done) #5 /), { metaKey: true });
  fireEvent.click(screen.getByLabelText(/^(?:Idle|Blocked|Done) #7 /), { metaKey: true });
  const button = screen.getByRole("button", { name: "Delete 2" });
  button.focus();
  fireEvent.click(button);
  await acknowledged();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/^(?:Idle|Blocked|Done) #9 /)));
});

it("u3787a_dismissing_a_restore_failure_preserves_undo", async () => {
  const { app, remove, connections } = await mount();
  await remove("/a");
  await acknowledged();
  app.of("/a").handlers["todo.restore"] = () => { throw new Error("Original Home is unavailable. Restore the Home and retry."); };

  pressUndo();
  const dismiss = await screen.findByRole("button", { name: "Dismiss" });
  fireEvent.click(dismiss);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(connections.get("/a")!.drafts.todoUndo.available("todo:5")).toBe(true);
});

it("u3787a_unknown_restore_consumes_only_the_reconciled_receipt", async () => {
  const { app, remove } = await mount();
  await remove("/a");
  await acknowledged();
  let restored = false;
  // SAFETY: the source call is filtered to todo.delete and its generated params contain operation.
  const params = app.of("/a").calls.filter(call => call.method === "todo.delete")[0]!.params as { operation: string };
  app.of("/a").handlers["todo.deletion"] = () => ({ operation: params.operation, deleted: [5], missing: [], state: restored ? "restored" : "deleted" });
  app.of("/a").handlers["todo.restore"] = () => { restored = true; throw new Error("reply lost after restore"); };

  pressUndo();
  await waitFor(() => expect([...histories.values()].every(open => !open.drafts.todoUndo.pending())).toBe(true));
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
  pressUndo();
  await waitFor(() => expect(app.of("/a").calls.filter(c => c.method === "todo.restore").map(c => c.params)).toEqual([
    { operation: expect.any(String) },
  ]));
  expect(app.of("/a").calls.filter(c => c.method === "todo.delete").map(c => c.params)).toEqual([
    { ids: [5], operation: expect.any(String) }, { ids: [7], operation: expect.any(String) },
  ]);
});

for (const entry of ["selection", "single", "clear-done"] as const) {
  it(`u3787a_delete_has_no_question_and_freezes_targets_${entry}`, async () => {
    const { app, connections } = await mount(entry === "clear-done");
    const daemon = app.of("/a");
    daemon.handlers["todo.list"] = () => [todo(5, { done: entry === "clear-done" }), todo(7, { done: entry === "clear-done" })];
    await showEverythingInApp();

    if (entry === "clear-done") fireEvent.click(await screen.findByText("Clear done", { selector: "button" }));
    else {
      const first = await screen.findByLabelText(/^(?:Idle|Blocked|Done) #5 /);

      if (entry === "selection") {
        fireEvent.click(first, { metaKey: true });
        fireEvent.click(screen.getByLabelText(/^(?:Idle|Blocked|Done) #7 /), { metaKey: true });
        fireEvent.click(screen.getByText("Delete 2", { selector: "button" }));
      } else { first.focus(); fireEvent.keyDown(first, { key: "d", code: "KeyD" }); }
    }

    await waitFor(() => expect(daemon.calls.filter(c => c.method === "todo.delete").map(c => c.params)).toEqual([
      { operation: expect.any(String), ids: entry === "single" ? [5] : [5, 7] },
    ]));
    expect([questionProbe.shown]).toEqual([null]);
    await acknowledged();
    expect(connections.get("/a")!.drafts.todoUndo.available("shelf")).toBe(true);
    expect(connections.get("/a")!.drafts.todoUndo.available("todos")).toBe(false);
    pressUndo();
    await waitFor(() => expect(daemon.calls.filter(c => c.method === "todo.restore").map(c => c.params)).toEqual([{ operation: expect.any(String) }]));
  });
}

const showPads = async (name?: string) => {
  showShelfTab("Pads");
  await waitFor(() => {
    const groups = document.querySelectorAll('.pads-tab [data-shelf-group]');

    if (!groups.length) throw new Error("Pad groups are loading");

    for (const control of document.querySelectorAll<HTMLElement>('.pads-tab [data-shelf-group] [data-part="branch-control"]')) if (control.closest('[role="treeitem"]')?.getAttribute("aria-expanded") === "false") fireEvent.click(control);

    if (name) expect([...document.querySelectorAll(".pads-tab .pad-name")].some(row => row.textContent === name)).toBe(true);
  });
};

for (const entry of ["selection", "single", "drawer"] as const) {
  it(`u3787a_success_and_partial_failure_offer_only_acknowledged_undo_pads_${entry}`, async () => {
    const { app, connections } = await mount();
    const daemon = app.of("/a");
    await showEverythingInApp();
    await showPads();
    const first = (await screen.findByText("first", { selector: ".pad-name .shelf-title" })).closest<HTMLElement>(".pad-name")!;


    if (entry === "selection") {
      const remove = daemon.handlers["pad.delete"]!;
      daemon.handlers["pad.delete"] = p => { if (p.name === "second") throw new RpcError(-32002, "permission refused");

 return remove(p)!; };

      fireEvent.click(first, { metaKey: true });
      fireEvent.click(screen.getByText("second", { selector: ".pad-name .shelf-title" }).closest<HTMLElement>(".pad-name")!, { metaKey: true });
      fireEvent.click(screen.getByText("Delete 2", { selector: "button" }));
      await screen.findByText("Could not delete second: permission refused");
      expect(screen.getByText("second", { selector: ".pad-name .shelf-title" }).closest<HTMLElement>(".pad-name")!.getAttribute("aria-pressed")).toBe("true");

    } else if (entry === "single") { first.focus(); fireEvent.keyDown(first, { key: "d", code: "KeyD" }); }
    else {
      first.focus();
      fireEvent.keyDown(first, { key: "Enter", code: "Enter" });
      fireEvent.click(await within(screen.getByRole("complementary", { name: "Drawer" })).findByRole("button", { name: "Delete" }));
    }

    await acknowledged();
    expect(connections.get("/a")!.drafts.todoUndo.available(entry === "drawer" ? "pad:fixture-first" : "shelf")).toBe(true);
    expect(connections.get("/a")!.drafts.todoUndo.available("pads")).toBe(false);
    expect([questionProbe.shown]).toEqual([null]);
    expect(daemon.calls.filter(c => c.method === "pad.delete").map(c => c.params)).toEqual((entry === "selection" ? ["first", "second"] : ["first"]).map(name => ({ name, expectedIncarnation: `fixture-${name}`, operation: expect.any(String) })));
    pressUndo();

    await waitFor(() => expect(daemon.calls.filter(c => c.method === "pad.restore").length).toBe(1));
    await waitFor(() => expect(connections.get("/a")!.drafts.todoUndo.pending()).toBe(false));
    await showPads("first");
    (await screen.findByText("first", { selector: ".pad-name .shelf-title" })).closest<HTMLElement>(".pad-name")!;
    expect((await daemon.rpc("pad.read", { name: "first" }))).toEqual(padOf("first", AGENT, "original"));
    expect(daemon.calls.filter(c => ["agent.spawn", "terminal.spawn", "pad.create"].includes(c.method))).toEqual([]);
  });
}

it("u3787a_undo_failure_is_retryable_without_rerunning_restored_pad_members", async () => {
  const { app } = await mount();
  const daemon = app.of("/a");
  await showEverythingInApp();
  await showPads();
  fireEvent.click((await screen.findByText("first", { selector: ".pad-name .shelf-title" })).closest<HTMLElement>(".pad-name")!, { metaKey: true });
  fireEvent.click(screen.getByText("second", { selector: ".pad-name .shelf-title" }).closest<HTMLElement>(".pad-name")!, { metaKey: true });
  fireEvent.click(screen.getByText("Delete 2", { selector: "button" }));
  await acknowledged();
  const restore = daemon.handlers["pad.restore"]!;
  let refuse = true;
  let calls = 0;
  daemon.handlers["pad.restore"] = p => { calls++;

 if (calls === 2 && refuse) throw new RpcError(-32003, "name conflict");

 return restore(p)!; };

  pressUndo();
  await screen.findByText("second: name conflict");
  await daemon.rpc("pad.write", { name: "first", text: "edited after restore" });
  refuse = false;
  pressUndo();
  await waitFor(() => expect([...histories.values()].every(open => !open.drafts.todoUndo.pending())).toBe(true));
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
  const row = (await screen.findByText("first", { selector: ".pad-name .shelf-title" })).closest<HTMLElement>(".pad-name")!;
  row.focus();
  fireEvent.keyDown(row, { key: "d", code: "KeyD" });
  const check = await screen.findByRole("button", { name: "Check deletion" });
  expect([screen.queryByText(DELETED)]).toEqual([null]);
  daemon.handlers["pad.getDeletion"] = read;
  fireEvent.click(check);
  await acknowledged();
  pressUndo();
  (await screen.findByText("first", { selector: ".pad-name .shelf-title" })).closest<HTMLElement>(".pad-name")!;
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
  const row = (await screen.findByText("first", { selector: ".pad-name .shelf-title" })).closest<HTMLElement>(".pad-name")!;
  row.focus();
  fireEvent.keyDown(row, { key: "d", code: "KeyD" });
  fireEvent.keyDown(row, { key: "d", code: "KeyD" });
  await daemon.rpc("pad.create", { name: "arrival", text: "new" });
  await screen.findByText("arrival", { selector: ".pad-name .shelf-title" });
  release();
  await acknowledged();
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

    if (entry === "clear-done") fireEvent.click(await screen.findByText("Clear done", { selector: "button" }));
    else {
      fireEvent.click(await screen.findByLabelText(/^(?:Idle|Blocked|Done) #5 /), { metaKey: true });
      fireEvent.click(screen.getByLabelText(/^(?:Idle|Blocked|Done) #7 /), { metaKey: true });
      fireEvent.click(screen.getByText("Delete 2", { selector: "button" }));
    }

    await screen.findByText("Could not delete same #7: The chosen Todo is no longer available. Refresh to check again.");
    expect(screen.getByLabelText(/^(?:Idle|Blocked|Done) #7 /).getAttribute("aria-pressed")).toBe("true");
    pressUndo();
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
  expect(retained.filter(draft => draft.destination.surface === "pads").map(draft => draft.value.source)).toEqual([expect.stringContaining("unfinished")]);
  fireEvent.click(within(screen.getByLabelText("Drawer")).getByRole("button", { name: "Delete" }));
  await acknowledged();
  expect(connected.drafts.list()).toEqual(retained);
  pressUndo();
  await waitFor(() => expect(connected.drafts.todoUndo.pending()).toBe(false));
  await showPads("second");
  expect(connected.drafts.list()).toEqual(retained);
});

for (const kind of ["todo", "pad"] as const) {
  it(`u3787a_refused_shelf_delete_announces_only_the_chosen_item_${kind}`, async () => {
    const { app } = await mount();
    const daemon = app.of("/a");
    const refusal = "The original Home changed. Restore the Home and retry deletion.";

    if (kind === "todo") {
      daemon.handlers["todo.delete"] = () => { throw new RpcError(-32003, refusal); };
    } else {
      daemon.handlers["pad.delete"] = () => { throw new RpcError(-32003, refusal); };
    }

    await showEverythingInApp();

    if (kind === "pad") await showPads();

    const row = kind === "todo" ? await screen.findByLabelText(/^(Idle|Blocked|Done) #5 /) : (await screen.findByText("first", { selector: ".pad-name .shelf-title" })).closest<HTMLElement>(".pad-name")!;
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Backspace", code: "Backspace" });
    await screen.findByRole("alert", { name: new RegExp(`Could not delete .*${refusal}`) });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(row.getAttribute("aria-pressed")).toBe("true");
  });
}

const deletions = (daemon: FakeApp): DeleteParams[] => daemon.calls.filter(call => call.method === "todo.delete").map(call => {
  // SAFETY: journal entries filtered to todo.delete have the generated DeleteParams.
  return call.params as DeleteParams;
});

const draftBytes = "  未送信 é 🧭\n keep trailing spaces  ";

const openSeventh = async (connections: Map<string, ConnectedProject>) => {
  const connected = connections.get("/a")!;
  connected.drawer.open(() => <TodoHost id={7} />, "key");
  const drawer = screen.getByRole("complementary", { name: "Drawer" });
  const button = await within(drawer).findByRole<HTMLButtonElement>("button", { name: "More actions" });

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
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));
  await within(drawer).findByText("Deleting #5 is unconfirmed. Check that deletion before trying Delete again.");
  expect(connected.drawer.content()).toBe(opening);
  expect(document.activeElement).toBe(button);
  expect(field.value).toBe(draftBytes);
  const recovery = within(drawer).getByRole<HTMLButtonElement>("button", { name: "Check deletion" });
  expect(recovery.disabled).toBe(false);
  const feedback = within(drawer).getByRole("alert");
  const announcements: string[] = [];
  const observer = new MutationObserver(() => { announcements.push(feedback.textContent ?? ""); });
  observer.observe(feedback, { childList: true, characterData: true, subtree: true });
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));
  await waitFor(() => expect(announcements).toContain(feedback.textContent));
  observer.disconnect();
  recovery.focus();
  expect(document.activeElement).toBe(recovery);
  expect(app.of("/a").calls.filter(call => ["todo.delete", "todo.restore", "todo.comment", "todo.update"].includes(call.method))).toEqual([
    { method: "todo.delete", params: { operation: expect.any(String), ids: [5] } },
  ]);
  expect(app.of("/b").calls.filter(call => ["todo.delete", "todo.restore"].includes(call.method))).toEqual([]);
});

it("u3787a_a_drawer_delete_explains_an_unconfirmed_pad_deletion", async () => {
  const { app, connections } = await mount();
  const daemon = app.of("/a");
  const remove = daemon.handlers["pad.delete"]!;
  daemon.handlers["pad.delete"] = async params => { await remove(params); throw new Error("reply lost"); };

  daemon.handlers["pad.getDeletion"] = () => { throw new Error("offline"); };

  await showEverythingInApp();
  await showPads();
  const row = (await screen.findByText("first", { selector: ".pad-name .shelf-title" })).closest<HTMLElement>(".pad-name")!;
  row.focus();
  fireEvent.keyDown(row, { key: "d", code: "KeyD" });
  await screen.findByRole("button", { name: "Check deletion" });
  const { drawer, button, field, connected, opening } = await openSeventh(connections);
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));
  await within(drawer).findByRole("alert", { name: "An earlier deletion is unconfirmed. Check deletion first." });
  expect(connected.drawer.content()).toBe(opening);
  expect(field.value).toBe(draftBytes);
  expect(document.activeElement).toBe(button);
  expect(within(drawer).getByRole<HTMLButtonElement>("button", { name: "Check deletion" }).disabled).toBe(false);
  expect(daemon.calls.filter(call => ["todo.delete", "todo.restore"].includes(call.method))).toEqual([]);
});

it("u3787g_recovery_keeps_the_original_target_and_requires_a_new_delete", async () => {
  const { app, connections, daemon } = await unconfirmed();
  const { button, drawer, field, connected, opening } = await openSeventh(connections);
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));
  const recovery = await within(drawer).findByRole("button", { name: "Check deletion" });
  const original = deletions(daemon)[0]!;
  daemon.handlers["todo.deletion"] = p => ({ operation: p.operation, deleted: [5], missing: [], state: "deleted" });
  fireEvent.click(recovery);
  await acknowledged();
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
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));
  await waitFor(() => expect(connected.drawer.content()).toBe(null));
  expect(daemon.calls.filter(call => call.method === "todo.delete")).toEqual([
    { method: "todo.delete", params: original }, { method: "todo.delete", params: { operation: expect.any(String), ids: [7] } },
  ]);
  daemon.handlers["todo.restore"] = p => ({ operation: p.operation, deleted: [7], missing: [], state: "restored", restoration: "restoration-5" });
  pressUndo();
  await waitFor(() => expect(daemon.calls.filter(call => call.method === "todo.restore")).toEqual([
    { method: "todo.restore", params: { operation: deletions(daemon)[1]!.operation } },
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
  pressUndo();
  await waitFor(() => expect(daemon.calls.filter(call => call.method === "todo.restore")).toEqual([
    { method: "todo.restore", params: { operation: deletions(daemon)[0]!.operation } },
  ]));
  opened.button.focus();
  fireEvent.click(opened.button);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));

  return { ...mounted, ...opened, daemon, finish };
};

it("u3787h_a_drawer_delete_explains_the_pending_restore", async () => {
  const { app, daemon, connected, opening, drawer, button, field } = await restoring();
  const progress = await within(drawer).findByText("Restoration is in progress. Wait for it to finish, then try Delete again.");
  expect(within(drawer).queryByRole("alert")).toBe(null);
  expect(progress.closest('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
  expect(connected.drawer.content()).toBe(opening);
  expect(document.activeElement).toBe(button);
  expect(field.value).toBe(draftBytes);
  expect(daemon.calls.filter(call => ["todo.delete", "todo.restore", "todo.comment", "todo.update"].includes(call.method))).toEqual([
    { method: "todo.delete", params: { operation: expect.any(String), ids: [5] } },
    { method: "todo.restore", params: { operation: deletions(daemon)[0]!.operation } },
  ]);
  expect(app.of("/b").calls.filter(call => ["todo.delete", "todo.restore"].includes(call.method))).toEqual([]);
});

it("u3787h_restore_completion_requires_a_new_delete", async () => {
  const { daemon, finish, connected, opening, drawer, button, field } = await restoring();
  await within(drawer).findByText("Restoration is in progress. Wait for it to finish, then try Delete again.");
  const operation = deletions(daemon)[0]!.operation;
  finish({ operation, deleted: [5], missing: [], state: "restored" });
  await waitFor(() => expect(within(drawer).queryByText("Restoration is in progress. Wait for it to finish, then try Delete again.")).toBe(null));
  expect(connected.drawer.content()).toBe(opening);
  expect(field.value).toBe(draftBytes);
  expect(document.activeElement).toBe(button);
  expect(daemon.calls.filter(call => call.method === "todo.delete")).toEqual([
    { method: "todo.delete", params: { operation, ids: [5] } },
  ]);
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));
  await waitFor(() => expect(connected.drawer.content()).toBe(null));
  await acknowledged();
  expect(daemon.calls.filter(call => call.method === "todo.delete")).toEqual([
    { method: "todo.delete", params: { operation, ids: [5] } },
    { method: "todo.delete", params: { operation: expect.any(String), ids: [7] } },
  ]);
  pressUndo();
  await waitFor(() => expect(daemon.calls.filter(call => call.method === "todo.restore")).toEqual([
    { method: "todo.restore", params: { operation } },
    { method: "todo.restore", params: { operation: deletions(daemon)[1]!.operation } },
  ]));
});

it("u3787a_pending_restore_disables_history_until_acknowledgement", async () => {
  const { app, remove, connections } = await mount();
  await remove("/a");
  const undo = connections.get("/a")!.drafts.todoUndo;
  await acknowledged();
  let finish!: () => void;
  app.of("/a").handlers["todo.restore"] = p => new Promise(resolve => {
    finish = () => resolve({ operation: p.operation, deleted: [5], missing: [], state: "restored", restoration: "restoration-5" });
  });
  pressUndo();
  await waitFor(() => expect(app.of("/a").calls.some(call => call.method === "todo.restore")).toBe(true));
  expect(undo.redoAvailable("todo:5")).toBe(false);
  expect(undo.undoLabel("todo:5")).toBe("Undo");
  expect(undo.redoLabel("todo:5")).toBe("Redo");
  await waitFor(() => expect(projectMenu.items.some(item => item.id === "action:chord:⌘Z" && item.enabled)).toBe(false));
  finish();
  await waitFor(() => expect(undo.redoAvailable("todo:5")).toBe(true));
  expect(undo.redoLabel("todo:5")).toBe("Redo Delete Todo");
});


it("u3787a_edit_menu_tracks_focused_history", async () => {
  const { app, remove, connections } = await mount();
  await remove("/a");
  const history = connections.get("/a")!.drafts.todoUndo;
  await waitFor(() => expect(history.pending()).toBe(false));
  const destination = document.createElement("button");
  destination.dataset.historyRegion = "todo:5";
  document.body.append(destination);
  destination.focus();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:⌘Z")?.label).toBe("Undo Delete Todo"));
  expect(screen.queryByText(DELETED)).toBeNull();
  expect([...document.querySelectorAll("button")].filter(button => button.textContent === "Undo")).toEqual([]);
  expect([...document.querySelectorAll("button")].filter(button => button.textContent === "Dismiss")).toEqual([]);
  app.of("/a").handlers["todo.redo"] = p => ({ operation: p.operation, deleted: [5], missing: [], state: "deleted" });
  undoKey();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:⇧⌘Z")?.label).toBe("Redo Delete Todo"));
  openProjectPage("action:chord:⇧⌘Z", "/a");
  await waitFor(() => expect(app.of("/a").calls.filter(call => call.method === "todo.redo").map(call => call.params)).toEqual([{ operation: expect.any(String), source: expect.any(String), restoration: "restoration-5" }]));
  const empty = document.createElement("button");
  empty.dataset.historyRegion = "pads";
  document.body.append(empty);
  empty.focus();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:⌘Z")?.enabled).toBe(false));
  undoKey();
  expect(app.of("/a").calls.filter(call => call.method === "todo.restore").map(call => call.params)).toEqual([{ operation: expect.any(String) }]);
  destination.remove();
  empty.remove();
});
