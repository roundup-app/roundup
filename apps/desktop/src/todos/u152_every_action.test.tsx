import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { event, workstream, USER } from "../testing/nodes";
import { RpcError } from "../app/seam";
import { mountTodos, todo, todoCallsTo as callsTo, todoEvent, todoRowOf as rowOf } from "./testHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

type Mounted = Awaited<ReturnType<typeof mountTodos>>;

const drawer = () => screen.getByRole("complementary", { name: "Drawer" });

/** The Event the Daemon sends after a write: the list refetches from the store. */
const refetch = ({ app, store }: Mounted) => app.emit(todoEvent("todo.updated", { ...store.todos[0]! }));

/** A pointer click, or the keyboard: focus the target and press it, which a browser turns into a click on a button (Enter or Space). */
const press = (target: HTMLElement, by: "pointer" | "keyboard") => {
  if (by === "keyboard") {
    target.focus();
    expect(document.activeElement).toBe(target);
  }

  fireEvent.click(target);
};

const rowText = (id: number) => rowOf(id).textContent;

const openDrawerOf = async (id: number) => {
  fireEvent.keyDown(await screen.findByRole("button", { name: new RegExp(`^(Idle|Blocked) #${id} `) }), { key: "Enter" });
  await within(drawer()).findByRole("button", { name: /^Blocked by/ });
};

for (const by of ["pointer", "keyboard"] as const) {
  describe(`u152 every Todo action by the ${by}`, () => {
    it(`u152_add_${by}`, async () => {
      const mounted = await mountTodos([todo(1)]);
      mounted.app.handlers["todo.create"] = ({ title }) => {
        mounted.store.todos = [...mounted.store.todos, todo(2, { title })];

        return mounted.store.todos[1]!;
      };

      press(await screen.findByRole("button", { name: "add todo to Overview" }), by);

      const field = screen.getByRole("textbox", { name: "New Todo title" });

      fireEvent.input(field, { target: { value: "ship it" } });
      fireEvent.keyDown(field, { key: "Enter" });
      await waitFor(() => expect(callsTo(mounted.app, "todo.create")).toEqual([{ method: "todo.create", params: { title: "ship it", body: null, blockers: null } }]));
      refetch(mounted);

      await waitFor(() => expect(rowText(2)).toContain("ship it"));
    });

    it(`u152_edit_${by}`, async () => {
      const mounted = await mountTodos([todo(1), todo(2)]);

      await openDrawerOf(2);
      await within(drawer()).findByRole("region", { name: "Todo history" });

      const title = within(drawer()).getByText("todo 2");

      if (by === "pointer") fireEvent.dblClick(title);
      else {
        title.focus();
        fireEvent.keyDown(title, { key: "Enter" });
      }

      const field = await within(drawer()).findByLabelText<HTMLTextAreaElement>("Title");

      fireEvent.input(field, { target: { value: "renamed" } });
      fireEvent.change(field, { target: { value: "renamed" } });
      fireEvent.blur(field);
      await waitFor(() => expect(callsTo(mounted.app, "todo.update")).toEqual([{ method: "todo.update", params: { id: 2, title: "renamed", body: null, expected_change: 2 } }]));
      refetch(mounted);

      await waitFor(() => expect(rowText(2)).toContain(field.value));
    });

    it(`u152_block_${by}`, async () => {
      const mounted = await mountTodos([todo(1), todo(2)]);

      await openDrawerOf(2);
      press(within(drawer()).getByRole("button", { name: /Blocker/ }), by);

      if (by === "pointer") fireEvent.click(await screen.findByRole("option", { name: /#1/ }));
      else fireEvent.keyDown(await screen.findByRole("combobox"), { key: "Enter" });
      await waitFor(() => expect(callsTo(mounted.app, "todo.setBlockers")).toEqual([{ method: "todo.setBlockers", params: { id: 2, blockers: [1], expected_change: 2 } }]));
      refetch(mounted);

      await waitFor(() => expect(rowOf(2).getAttribute("aria-level")).toBe("2"));
    });

    it(`u152_unblock_${by}`, async () => {
      const mounted = await mountTodos([todo(1), todo(3), todo(2, { blocked: true, blockers: [1, 3] })]);

      await openDrawerOf(2);
      press(within(drawer()).getByRole("button", { name: "Remove blocker #1" }), by);
      await waitFor(() => expect(callsTo(mounted.app, "todo.setBlockers")).toEqual([{ method: "todo.setBlockers", params: { id: 2, blockers: [3], expected_change: 2 } }]));
      refetch(mounted);
      await waitFor(() => expect(within(rowOf(2)).queryByRole("button", { name: /todo 1$/ })).toBeNull());
      expect(rowOf(2).getAttribute("aria-level")).toBe("2");

      press(within(drawer()).getByRole("button", { name: "Remove blocker #3" }), by);
      await waitFor(() => expect(callsTo(mounted.app, "todo.setBlockers")[1]?.params).toEqual({ id: 2, blockers: [], expected_change: 4 }));
      refetch(mounted);

      await waitFor(() => expect(rowOf(2).getAttribute("aria-level")).toBe("1"));
    });

    it(`u152_complete_from_the_row_${by}`, async () => {
      const mounted = await mountTodos([todo(1), todo(2)]);

      await screen.findByRole("button", { name: /^Idle #2 / });

      if (by === "pointer") fireEvent.mouseEnter(rowOf(2));
      else (await screen.findByRole("button", { name: /^Idle #2 / })).focus();

      press(await screen.findByRole("checkbox", { name: "Complete todo 2" }), by);
      await waitFor(() => expect(callsTo(mounted.app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 2 } }]));
      refetch(mounted);

      await screen.findByRole("button", { name: "1 done" });
      expect(document.querySelector('[data-id="2"]')).toBeNull();
    });

    it(`u152_complete_from_the_drawer_${by}`, async () => {
      const mounted = await mountTodos([todo(1), todo(2)]);

      await openDrawerOf(2);
      press(await within(drawer()).findByRole("checkbox", { name: "Complete todo 2" }), by);
      await waitFor(() => expect(callsTo(mounted.app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 2 } }]));
    });

    it(`u152_delete_${by}`, async () => {
      const mounted = await mountTodos([todo(1), todo(2)]);

      await openDrawerOf(2);
      press(await within(drawer()).findByRole("button", { name: "Delete Todo" }), by);
      await waitFor(() => expect(callsTo(mounted.app, "todo.delete")).toEqual([{ method: "todo.delete", params: { operation: expect.any(String), ids: [2] } }]));
      mounted.app.emit(todoEvent("todo.updated", { ...mounted.store.todos[0]! }));

      await waitFor(() => expect(document.querySelector('[data-id="2"]')).toBeNull());
    });
  });
}

describe("u152 focus stays in the Drawer", () => {
  it("u152_choosing_an_offered_blocker_by_keyboard_leaves_focus_off_the_body", async () => {
    await mountTodos([todo(1), todo(2)]);
    await openDrawerOf(2);
    press(within(drawer()).getByRole("button", { name: /Blocker/ }), "keyboard");
    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "Enter" });

    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(drawer().contains(document.activeElement)).toBe(true);
  });

  it("u152_remove_by_keyboard_leaves_focus_off_the_body", async () => {
    const mounted = await mountTodos([todo(1), todo(3), todo(2, { blocked: true, blockers: [1, 3] })]);

    await openDrawerOf(2);
    press(within(drawer()).getByRole("button", { name: "Remove blocker #1" }), "keyboard");
    await waitFor(() => expect(callsTo(mounted.app, "todo.setBlockers")).toHaveLength(1));
    mounted.store.todos = mounted.store.todos.map((t) => (t.id === 2 ? { ...t, blockers: [3] } : t));
    refetch(mounted);

    await waitFor(() => expect(within(rowOf(2)).queryByRole("button", { name: /todo 1$/ })).toBeNull());
    expect(rowOf(2).getAttribute("aria-level")).toBe("2");
    expect(document.activeElement).not.toBe(document.body);
    expect(drawer().contains(document.activeElement)).toBe(true);
  });
});

describe("u152 remove a blocker", () => {
  it("u152_remove_names_each_blocker_done_or_open_and_keeps_the_waits_on_listing", async () => {
    await mountTodos([todo(1, { done: true }), todo(3), todo(2, { blocked: true, blockers: [1, 3] })]);

    await openDrawerOf(2);

    for (const id of [1, 3]) expect(within(drawer()).getByRole("button", { name: `Remove blocker #${id}` }).textContent).toBe("Remove");
    expect(within(drawer()).getByText("Waits on").parentElement?.children).toHaveLength(5);
  });

  it("u152_a_failed_remove_shows_the_message_and_keeps_the_row", async () => {
    const mounted = await mountTodos([todo(1), todo(2, { blocked: true, blockers: [1] })]);

    mounted.app.handlers["todo.setBlockers"] = () => Promise.reject(new RpcError(-32010, "cannot remove"));
    await openDrawerOf(2);
    fireEvent.click(within(drawer()).getByRole("button", { name: "Remove blocker #1" }));

    expect((await within(drawer()).findByText(/cannot remove/)).textContent).toBe("cannot remove");
    expect(rowOf(2).getAttribute("aria-level")).toBe("2");
  });
});


it.each(["dismiss", "save", "delete", "failed-delete", "unrelated"] as const)("p3557c_failure_lifetime_todo_drawer_%s", async action => {
  const m = await mountTodos([todo(1), todo(2)]);
  await openDrawerOf(1);
  const field = within(drawer()).getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  const text = "  e\u0301 🧪\n次の行  ";
  fireEvent.input(field, { target: { value: text } });
  m.app.handlers["todo.complete"] = () => Promise.reject(new RpcError(-32003, "Cannot save; retry"));
  fireEvent.click(within(drawer()).getByRole("checkbox", { name: "Complete todo 1" }));
  await within(drawer()).findByRole("alert", { name: "Cannot save; retry" });
  const before = [...m.app.calls];

  if (action === "dismiss") fireEvent.click(within(drawer()).getByRole("button", { name: "Dismiss" }));
  else if (action === "save") {
    m.app.handlers["todo.complete"] = () => todo(1, { done: true });
    fireEvent.click(within(drawer()).getByRole("checkbox", { name: "Complete todo 1" }));
    await waitFor(() => expect(callsTo(m.app, "todo.complete")).toHaveLength(2));
  } else if (action === "unrelated") {
    m.app.emit(todoEvent("todo.updated", todo(2)));
    m.app.emit({ actor: USER, name: "todo.deleted", data: { id: 2 } });
  } else {
    if (action === "failed-delete") m.app.handlers["todo.delete"] = () => Promise.reject(new RpcError(-32003, "Cannot delete; retry"));
    fireEvent.click(within(drawer()).getByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));
  }

  if (action === "delete") {
    await waitFor(() => expect(drawer().inert).toBe(true));
    m.app.emit({ actor: USER, name: "todo.deleted", data: { id: 1 } });
    await waitFor(() => expect(document.querySelector('[data-id="1"]')).toBeNull());
    await openDrawerOf(2);
    expect(within(drawer()).queryByRole("alert")).toBeNull();
  } else {
    const stays = action === "unrelated";
    const message = action === "failed-delete" ? "Cannot delete; retry" : "Cannot save; retry";
    await waitFor(() => expect(within(drawer()).queryByRole("alert", { name: message }) !== null).toBe(stays || action === "failed-delete"));
    expect(field.value).toBe(text);
    expect(m.store.todos.map(item => item.id)).toEqual([1, 2]);

    if (action === "dismiss") expect(writes(m.app.calls)).toEqual(writes(before));
  }
});


const exactDraft = "  e\u0301 🧪\n次の行  ";

const writes = (calls: Mounted["app"]["calls"]) => calls.filter(call => ["todo.complete", "todo.reopen", "todo.update", "todo.comment", "todo.delete", "todo.removeRef", "todo.setBlockers", "todo.reorder", "workstream.setAuto"].includes(call.method));

const lifetimeActions = ["dismiss", "save", "delete", "failed-delete"] as const;

for (const owner of ["open_row", "open_row_move", "editable_text_title", "editable_text_body", "todo_comments", "todo_refs", "todo_history"] as const) {
  it.each(lifetimeActions)(`p3557c_failure_lifetime_${owner}_%s`, async action => {
    const deleteRefusal = "Delete refused; retry";
    const url = "roundup://pad/notes?project=test";
    const m = await mountTodos([todo(1, { body: "Original body", refs: [url] }), todo(2), todo(3)]);
    await openDrawerOf(1);
    await waitFor(() => expect(callsTo(m.app, "todo.getHistory")).toHaveLength(1));
    const comment = within(drawer()).getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
    fireEvent.input(comment, { target: { value: exactDraft } });
    const refuse = () => Promise.reject(new RpcError(-32003, "Item unavailable; retry"));
    const fieldName = owner === "editable_text_title" ? "Title" : "Body";
    let field: HTMLTextAreaElement | undefined;

    if (owner === "open_row_move") {
      m.app.handlers["todo.reorder"] = refuse;
      fireEvent.contextMenu(rowOf(1));
      await m.app.pickMenu("Move down");
    } else if (owner === "open_row") {
      m.app.handlers["todo.complete"] = refuse;
      fireEvent.click(within(rowOf(1)).getByRole("checkbox", { name: "Complete todo 1" }));
    } else if (owner.startsWith("editable_text")) {
      m.app.handlers["todo.update"] = refuse;
      fireEvent.dblClick(within(drawer()).getByText(fieldName === "Title" ? "todo 1" : "Original body"));
      field = await within(drawer()).findByRole<HTMLTextAreaElement>("textbox", { name: fieldName });
      fireEvent.input(field, { target: { value: fieldName === "Title" ? "  e\u0301 🧪 title  " : exactDraft } });
      fireEvent.click(within(drawer()).getByRole("button", { name: "Save" }));
    } else if (owner === "todo_comments") {
      m.app.handlers["todo.comment"] = refuse;
      fireEvent.click(within(drawer()).getByRole("button", { name: "Comment" }));
    } else if (owner === "todo_refs") {
      m.app.handlers["todo.removeRef"] = refuse;
      fireEvent.click(await within(drawer()).findByRole("button", { name: "Remove link to notes" }));
    } else {
      m.app.clipboardWrite = refuse;
      fireEvent.click(await within(drawer()).findByRole("button", { name: /^Changes/ }));
      fireEvent.click(await within(drawer()).findByRole("button", { name: "Copy" }));
    }

    const region = () => owner.startsWith("open_row") ? within(rowOf(1)) : within(drawer());
    const failure = await region().findByRole("alert", { name: /Item unavailable; retry/ });
    const message = failure.getAttribute("aria-label")!;
    const retained = m.connected.drafts.list();
    const calls = [...m.app.calls];
    // Same titles and unrelated deletion/saves cannot consume this item's failure or input.
    m.store.todos = m.store.todos.map(item => item.id === 2 ? { ...item, title: "todo 1" } : item).filter(item => item.id !== 3);
    m.app.emit(todoEvent("todo.updated", m.store.todos[1]!));
    m.app.emit({ actor: USER, name: "todo.deleted", data: { id: 3 } });
    await m.todos.reload();
    expect(region().getByRole("alert", { name: message })).toBeTruthy();
    expect(comment.value).toBe(exactDraft);
    expect(m.connected.drafts.list()).toEqual(retained);

    if (action === "dismiss") {
      if (owner.startsWith("open_row")) {
        fireEvent.contextMenu(rowOf(1));
        await m.app.pickMenu("Dismiss");
      } else {
        const dismiss = within(failure.closest<HTMLElement>(".reserved-line")!).getByRole("button", { name: "Dismiss" });
        const editor = within(drawer()).queryByRole("textbox", { name: fieldName });

        if (editor) fireEvent.blur(editor, { relatedTarget: dismiss });
        fireEvent.click(dismiss);
      }

      // EditableText queues blur submission in a microtask; dismissal must leave that revision unsent.
      await Promise.resolve();
      expect(writes(m.app.calls)).toEqual(writes(calls));
    } else if (action === "save") {
      // A different field on this same item acknowledges success, even before its Event arrives.
      let acknowledge!: (value: ReturnType<typeof todo>) => void;
      m.app.handlers["todo.complete"] = () => new Promise(resolve => { acknowledge = resolve; });
      fireEvent.click(within(drawer()).getByRole("checkbox", { name: "Complete todo 1" }));
      await waitFor(() => expect(callsTo(m.app, "todo.complete").length).toBe(owner === "open_row" ? 2 : 1));
      expect(region().getByRole("alert", { name: message })).toBeTruthy();
      acknowledge(todo(1));

      // The row receives the acknowledged change through the existing Daemon Event.
      if (owner.startsWith("open_row")) m.app.emit(todoEvent("todo.updated", m.store.todos[0]!));
    } else {
      if (action === "failed-delete") m.app.handlers["todo.delete"] = () => Promise.reject(new RpcError(-32003, deleteRefusal));
      fireEvent.click(within(drawer()).getByRole("button", { name: "More actions" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));
    }

    if (action === "delete") {
      await waitFor(() => expect(drawer().inert).toBe(true));
      m.app.emit({ actor: USER, name: "todo.deleted", data: { id: 1 } });
      await waitFor(() => expect(document.querySelector('[data-id="1"]')).toBeNull());
      await openDrawerOf(2);
      expect(within(drawer()).queryByRole("alert", { name: message })).toBeNull();
      // Removal does not consume recoverable work; reintroducing this original identity restores its comment.
      m.store.todos = [todo(1, { body: "Original body" }), todo(2)];
      m.app.emit(todoEvent("todo.created", m.store.todos[0]!));
      await openDrawerOf(1);
      expect(within(drawer()).getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" }).value).toBe(exactDraft);
    } else {
      const remains = action === "failed-delete";
      await waitFor(() => expect(region().queryByRole("alert", { name: message }) !== null).toBe(remains));
      expect(comment.value).toBe(exactDraft);

      if (field && remains) expect(within(drawer()).getByRole<HTMLTextAreaElement>("textbox", { name: fieldName }).value).toBe(fieldName === "Title" ? "  e\u0301 🧪 title  " : exactDraft);

      if (action === "failed-delete") { const failed = await within(drawer()).findByRole("alert", { name: deleteRefusal }); expect(drawer().contains(failed)).toBe(true); }
    }

    expect(m.connected.drafts.list()).toEqual(retained);
    expect(m.store.todos.find(item => item.id === 2)?.body).toBe("");
  });
}

it.each(["dismiss", "save", "switch", "delete"] as const)("p3557c_failure_lifetime_delegate_board_%s", async action => {
  const m = await mountTodos([todo(1, { home: "a" }), todo(2, { home: "b" })], true, [workstream("a"), workstream("b")]);
  m.connected.rail.select("a");
  const control = await screen.findByRole("switch", { name: "Auto" });
  m.app.handlers["workstream.setAuto"] = () => Promise.reject(new RpcError(-32003, "Cannot automate; retry"));
  fireEvent.click(control);
  await screen.findByRole("alert", { name: "Cannot automate; retry" });
  m.app.emit(event({ name: "workstream.updated", data: { id: "b", auto: true } }));
  m.app.emit({ actor: USER, name: "todo.deleted", data: { id: 2 } });
  expect(screen.getByRole("alert", { name: "Cannot automate; retry" })).toBeTruthy();
  const before = [...m.app.calls];

  if (action === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  else if (action === "save") {
    m.app.handlers["workstream.setAuto"] = () => null;
    fireEvent.click(control);
  } else if (action === "switch") m.connected.rail.select("b");
  else {
    m.app.handlers["rail.tree"] = () => [workstream("b")];
    m.app.emit(event({ name: "rail.changed" }));
  }

  await waitFor(() => expect(screen.queryByRole("alert", { name: "Cannot automate; retry" })).toBeNull());

  if (action === "dismiss") expect(writes(m.app.calls)).toEqual(writes(before));
  expect(m.store.todos).toEqual([todo(1, { home: "a" }), todo(2, { home: "b" })]);
});


for (const owner of ["todo_comments", "todo_history", "todo_refs"] as const) {
  it.each(["dismiss", "recover"] as const)(`p3557c_failure_lifetime_${owner}_load_%s`, async action => {
    const m = await mountTodos([todo(1), todo(2)]);
    const method = owner === "todo_comments" ? "todo.comments" : owner === "todo_history" ? "todo.getHistory" : "todo.refs";
    const original = m.app.handlers[method];
    Object.assign(m.app.handlers, { [method]: () => Promise.reject(new RpcError(-32003, "Read unavailable; retry")) });
    await openDrawerOf(1);
    await within(drawer()).findByRole("alert", { name: "Read unavailable; retry" });
    const field = within(drawer()).getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
    fireEvent.input(field, { target: { value: exactDraft } });
    m.app.emit(todoEvent("todo.updated", todo(2)));
    m.app.emit({ actor: USER, name: "todo.deleted", data: { id: 2 } });
    fireEvent.click(within(drawer()).getByRole("checkbox", { name: "Complete todo 1" }));
    await waitFor(() => expect(callsTo(m.app, "todo.complete")).toHaveLength(1));
    expect(within(drawer()).getByRole("alert", { name: "Read unavailable; retry" })).toBeTruthy();
    const before = writes(m.app.calls);

    if (action === "dismiss") fireEvent.click(within(drawer()).getByRole("button", { name: "Dismiss" }));
    else {
      Object.assign(m.app.handlers, { [method]: original });
      const retry = owner === "todo_comments" ? "Retry comments" : owner === "todo_history" ? "Retry history" : "Retry Pads";
      fireEvent.click(within(drawer()).getByRole("button", { name: retry }));
    }

    await waitFor(() => expect(within(drawer()).queryByRole("alert", { name: "Read unavailable; retry" })).toBeNull());
    expect(field.value).toBe(exactDraft);
    expect(writes(m.app.calls)).toEqual(before);
  });
}


it.each(["dismiss", "save", "delete"] as const)("p3557c_failure_lifetime_editable_text_recovery_%s", async action => {
  const m = await mountTodos([todo(1), todo(2)]);
  await openDrawerOf(1);
  fireEvent.click(within(drawer()).getByRole("button", { name: "Add notes" }));
  const field = await within(drawer()).findByRole<HTMLTextAreaElement>("textbox", { name: "Body" });
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  fireEvent.input(field, { target: { value: exactDraft } });
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(m.connected.drafts.problem()?.revision).toBe(m.connected.drafts.list().at(-1)?.revision));
  const retained = m.connected.drafts.list();
  const problem = m.connected.drafts.problem();
  m.app.clipboardWrite = () => Promise.reject(new Error("Clipboard unavailable; retry"));
  fireEvent.click(within(drawer()).getByRole("button", { name: "Copy Todo" }));
  await within(drawer()).findByRole("alert", { name: /Clipboard unavailable; retry/ });
  m.app.emit(todoEvent("todo.updated", todo(2)));
  expect(within(drawer()).getByRole("alert", { name: /Clipboard unavailable; retry/ })).toBeTruthy();

  if (action === "dismiss") fireEvent.click(within(drawer()).getByRole("button", { name: "Dismiss" }));
  else if (action === "save") {
    fireEvent.click(within(drawer()).getByRole("checkbox", { name: "Complete todo 1" }));
    await waitFor(() => expect(callsTo(m.app, "todo.complete")).toHaveLength(1));
  } else {
    fireEvent.click(within(drawer()).getByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Todo" }));
    await waitFor(() => expect(drawer().inert).toBe(true));
    m.app.emit({ actor: USER, name: "todo.deleted", data: { id: 1 } });
  }

  await waitFor(() => expect(screen.queryByRole("alert", { name: /Clipboard unavailable; retry/ })).toBeNull());
  expect(m.connected.drafts.problem()).toEqual(problem);
  expect(m.connected.drafts.list()).toEqual(retained);
  expect(await screen.findByRole("alert", { name: /couldn.t keep|could not|retained|retain/i })).toBeTruthy();
  storage.mockRestore();
});


it("p3557c_failure_lifetime_todo_drawer_removed_notice_dismiss", async () => {
  const m = await mountTodos([todo(1), todo(2)]);
  await openDrawerOf(1);
  m.app.handlers["todo.complete"] = () => Promise.reject(new RpcError(-32003, "Save refused; retry"));
  fireEvent.click(within(drawer()).getByRole("checkbox", { name: "Complete todo 1" }));
  await within(drawer()).findByRole("alert", { name: "Save refused; retry" });
  fireEvent.click(within(drawer()).getByRole("button", { name: "Add notes" }));
  const field = await within(drawer()).findByRole("textbox", { name: "Body" });
  fireEvent.input(field, { target: { value: exactDraft } });
  m.store.todos = [todo(2)];
  m.app.emit({ actor: USER, name: "todo.deleted", data: { id: 1 } });
  await m.todos.reload();
  await within(drawer()).findByRole("alert", { name: "#1 was deleted" });
  expect(within(drawer()).queryByRole("alert", { name: "Save refused; retry" })).toBeNull();
  const retained = m.connected.drafts.list();
  const calls = writes(m.app.calls);
  fireEvent.click(within(drawer()).getByRole("button", { name: "Dismiss" }));
  expect(within(drawer()).queryByRole("alert", { name: "#1 was deleted" })).toBeNull();
  expect(m.connected.drafts.list()).toEqual(retained);
  expect(retained.map(draft => [draft.destination.object, draft.destination.recipient, draft.value.text])).toEqual([["1", "body", exactDraft]]);
  expect(writes(m.app.calls)).toEqual(calls);
  await openDrawerOf(2);
  expect(within(drawer()).queryByRole("alert", { name: "#1 was deleted" })).toBeNull();
});
