import { answerQuestion } from "./bulkQuestionHarness";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo } from "../todos/testHarness";
import { deferred, openShelf, padOf } from "../pads/padsFixture";
import { RpcError } from "../app/seam";
import { USER } from "../testing/nodes";
import { stubDialogLayout, askToDelete, confirmDeletion, questionClosed, questionDialog } from "./bulkQuestionHarness";

afterEach(cleanup);

stubDialogLayout();

const pickTwo = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /#1 / }), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: /#2 / }), { metaKey: true });
};

it("u460_each_confirmed_target_is_called_once", async () => {
  const { app, store } = await mountTodos([todo(1), todo(2)]);
  const held = deferred<null>();
  app.handlers["todo.delete"] = async (params) => {
    if (params.id === 1) await held.promise;
    store.todos = store.todos.filter((row) => row.id !== params.id);

    return null;
  };

  await pickTwo();
  await askToDelete(2);
  await confirmDeletion();
  await answerQuestion(true);
  expect(todoCallsTo(app, "todo.delete")).toHaveLength(1);
  held.resolve(null);
  await questionClosed();
  expect(todoCallsTo(app, "todo.delete").map((call) => call.params)).toEqual([{ id: 1 }, { id: 2 }]);
});

it("u460_partial_failure_names_and_selects_only_failed_rows", async () => {
  const { app, store } = await mountTodos([todo(1, { title: "same" }), todo(2, { title: "same" })]);
  app.handlers["todo.delete"] = (params) => {
    if (params.id === 2) throw new RpcError(-32001, "denied");
    store.todos = store.todos.filter((row) => row.id !== params.id);

    return null;
  };

  await pickTwo();
  await askToDelete(2);
  await confirmDeletion();
  await screen.findByText("same #2: denied");
  expect(screen.getByText("1 selected")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /#1 / })).toBeNull();
  expect(screen.getByRole("button", { name: /#2 / }).getAttribute("aria-pressed")).toBe("true");
});

it("u460_lost_response_refetches_before_retry", async () => {
  const { app, store } = await mountTodos([todo(1), todo(2)]);
  app.handlers["todo.delete"] = (params) => {
    store.todos = store.todos.filter((row) => row.id !== params.id);
    throw new Error("response lost");
  };

  await pickTwo();
  await askToDelete(2);
  await confirmDeletion();
  await questionClosed();
  expect(screen.queryByRole("group", { name: "Work items deletion" })).toBeNull();
  expect(screen.queryByRole("button", { name: /#1 |#2 / })).toBeNull();
});

it("u460_cancel_keeps_selection_and_restores_focus", async () => {
  await mountTodos([todo(1), todo(2)]);
  await pickTwo();
  const button = screen.getByRole("button", { name: "Delete 2" });
  button.focus();
  await askToDelete(2);
  await answerQuestion(false);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete 2" })));
  expect(screen.getByText("2 selected")).toBeTruthy();
});

it("u460_confirmation_never_expands_or_outlives_its_scope", async () => {
  const { app, store, connected } = await mountTodos([todo(1), todo(2)]);
  await pickTwo();
  await askToDelete(2);
  store.todos.push(todo(3));
  app.emit({ actor: USER, name: "todo.created", data: todo(3) });
  await screen.findByRole("button", { name: /#3 / });
  expect((await questionDialog()).title).toBe("Delete 2 Todos?");
  connected.rail.select("scope-row");
  await answerQuestion(true);
  await questionClosed();
  expect(todoCallsTo(app, "todo.delete")).toEqual([]);
});

it("u460_backspace_is_local_and_repeat_safe", async () => {
  const { app } = await mountTodos([todo(1), todo(2)]);
  await pickTwo();
  const row = screen.getByRole("button", { name: /#1 / });
  row.focus();
  fireEvent.keyDown(row, { key: "Backspace", repeat: true });
  fireEvent.keyDown(row, { key: "Backspace", metaKey: true });
  fireEvent.keyDown(screen.getByRole("checkbox", { name: "Complete todo 1" }), { key: "Backspace" });
  expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
  fireEvent.keyDown(row, { key: "Backspace" });
  expect((await questionDialog()).title).toBe("Delete 2 Todos?");
  expect(todoCallsTo(app, "todo.delete")).toEqual([]);
});

it("u460_retry_confirms_only_the_remaining_set", async () => {
  const { app, store } = await mountTodos([todo(1), todo(2)]);
  let failed = true;
  app.handlers["todo.delete"] = (params) => {
    if (params.id === 2 && failed) throw new RpcError(-32001, "denied");
    store.todos = store.todos.filter((row) => row.id !== params.id);

    return null;
  };

  await pickTwo();
  await askToDelete(2);
  await confirmDeletion();
  await screen.findByText("todo 2 #2: denied");
  failed = false;
  await askToDelete(1);
  await confirmDeletion();
  await questionClosed();
  expect(todoCallsTo(app, "todo.delete").map((call) => call.params)).toEqual([{ id: 1 }, { id: 2 }, { id: 2 }]);
});

it("u460_failed_readback_blocks_retry_until_a_fresh_list_answers", async () => {
  const { app, store } = await mountTodos([todo(1), todo(2)]);
  await pickTwo();
  let lost = true;
  app.handlers["todo.list"] = () => {
    if (lost) throw new Error("list unavailable");

    return store.todos;
  };

  app.handlers["todo.delete"] = () => { throw new Error("response lost"); };

  await askToDelete(2);
  await confirmDeletion();
  await screen.findByRole("button", { name: "Refresh" });
  expect(screen.getByRole("button", { name: "Delete 2" }).hasAttribute("disabled")).toBe(true);
  lost = false;
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText("2 selected");
  expect(todoCallsTo(app, "todo.delete")).toHaveLength(2);
});

it("u460_readback_waits_for_a_newer_event_refetch_before_retry", async () => {
  const { app } = await mountTodos([todo(1), todo(2)]);
  const old = deferred<ReturnType<typeof todo>[]>();
  const fresh = deferred<ReturnType<typeof todo>[]>();
  let reads = 0;
  app.handlers["todo.list"] = () => ++reads === 1 ? old.promise : fresh.promise;
  app.handlers["todo.delete"] = () => { throw new Error("response lost"); };

  await pickTwo();
  await askToDelete(2);
  await confirmDeletion();
  await waitFor(() => expect(reads).toBe(1));
  app.emit({ actor: USER, name: "todo.updated", data: todo(2) });
  await waitFor(() => expect(reads).toBe(2));
  old.resolve([todo(1), todo(2)]);
  // Observe that no retry is offered while the newer list response is withheld.
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(screen.getByRole("button", { name: "Delete 2" }).hasAttribute("disabled")).toBe(true);
  fresh.resolve([todo(2)]);
  await screen.findByText("1 selected");
  await questionClosed();
  expect(screen.getByRole("button", { name: /#2 / }).getAttribute("aria-pressed")).toBe("true");
});

it("u460_plain_click_after_failure_clears_the_bar_before_opening_the_drawer", async () => {
  const { app } = await mountTodos([todo(1), todo(2)]);
  app.handlers["todo.delete"] = () => { throw new Error("denied"); };

  await pickTwo();
  await askToDelete(2);
  await confirmDeletion();
  await screen.findByText("todo 1 #1: denied");
  fireEvent.click(screen.getByRole("button", { name: /#1 / }));
  expect(screen.queryByRole("group", { name: "Work items deletion" })).toBeNull();
  expect(screen.getByRole("complementary", { name: "Drawer" })).toBeTruthy();
});

it.each([false, true])("u3474e_mutation_keeps_the_next_key_live: nested=%s", async nested => {
  const initial = nested ? [todo(1), todo(2), todo(3), todo(4, { blockers: [5] }), todo(5), todo(6)] : [todo(1), todo(2), todo(3)];
  const id = nested ? 3 : 2;
  const next = nested ? 5 : 3;
  const { app } = await mountTodos(initial);
  const row = await screen.findByRole("button", { name: new RegExp(`#${id} `) });
  row.focus();
  fireEvent.keyDown(row, { key: "d", code: "KeyD" });
  await confirmDeletion();
  await questionClosed();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: new RegExp(`#${next} `) })));
  fireEvent.keyDown(document.activeElement!, { key: "d", code: "KeyD" });
  const question = await questionDialog();
  expect(question.message).toContain(`todo ${next}`);
  expect(question.message).not.toContain("todo 1");
  expect(todoCallsTo(app, "todo.delete").map(call => call.params)).toEqual([{ id }]);
});

// BulkDelete owns deletion only; save acknowledgements belong to the item editors.
for (const owner of ["todos", "pads"] as const) {
  it.each(["deleted", "removed-event", "refused", "cancelled", "dismissed", "readback-unrelated"] as const)(`p3557c_failure_lifetime_shelf_${owner}_%s`, async action => {
    const fixture = owner === "todos"
      ? await mountTodos([todo(1, { title: "same" }), todo(2, { title: "same" }), todo(3)])
      : await openShelf([padOf("first", USER), padOf("second", USER), padOf("other", USER)]);

    const { app, connected } = fixture;
    const first = owner === "todos" ? 1 : "first";
    const row = (which: "first" | "second" | "other") => screen.getByRole("button", { name: owner === "todos" ? new RegExp(`#${{ first: 1, second: 2, other: 3 }[which]} `) : which });
    const message = (which: "first" | "second") => owner === "todos" ? `same #${which === "first" ? 1 : 2}: denied` : `${which}: denied`;
    const remove = owner === "todos" ? "todo.delete" : "pad.delete";
    const deleteTodo = app.handlers["todo.delete"];
    const deletePad = app.handlers["pad.delete"];

    const restore = () => {
      if (deleteTodo) app.handlers["todo.delete"] = deleteTodo;

      if (deletePad) app.handlers["pad.delete"] = deletePad;
    };

    app.handlers[remove] = () => { throw new RpcError(-32001, "denied"); };

    const draft = connected.drafts.edit({ surface: "todos", object: "3", recipient: "body" }, { text: "  unfinished é 🧭\n\nlast  ", base: "", expected_change: null, title: "todo 3", body: "", done: false, blockers: [] }, { start: 2, end: 9, direction: "forward" }, "ordinary").draft;
    const retained = connected.drafts.list();
    await screen.findByRole("button", { name: owner === "todos" ? /#1 / : "first" });
    fireEvent.click(row("first"), { metaKey: true });
    fireEvent.click(row("second"), { metaKey: true });
    await askToDelete(2);
    await confirmDeletion();
    await screen.findByText(message("first"));
    await screen.findByText(message("second"));
    const calls = app.calls.filter(call => call.method === remove).length;

    if (action === "readback-unrelated") {
      const listTodos = app.handlers["todo.list"];
      const listPads = app.handlers["pad.list"];
      app.handlers[owner === "todos" ? "todo.list" : "pad.list"] = () => { throw new Error("list unavailable"); };

      row("first").focus();
      fireEvent.keyDown(row("first"), { key: "d", code: "KeyD" });
      await confirmDeletion();
      await screen.findByRole("button", { name: "Refresh" });

      if (listTodos) app.handlers["todo.list"] = listTodos;

      if (listPads) app.handlers["pad.list"] = listPads;

      if ("store" in fixture) {
        fixture.store.todos = fixture.store.todos.filter(item => item.id !== 3);
        app.emit({ actor: USER, name: "todo.deleted", data: { id: 3 } });
      } else {
        fixture.state.pads = fixture.state.pads.filter(item => item.name !== "other");
        app.emit({ actor: USER, name: "pad.deleted", data: { name: "other" } });
      }

      await waitFor(() => expect(screen.queryByRole("button", { name: owner === "todos" ? /#3 / : "other" })).toBeNull());
      expect(within(screen.getByRole("group", { name: "Work items deletion" })).getByRole("alert").textContent).toContain("list unavailable");
      expect(connected.drafts.list()).toEqual(retained);
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await questionClosed();
      expect(screen.getByText(message("second"))).toBeTruthy();

      return;
    }

    if (action === "dismissed") {
      fireEvent.click(screen.getByRole("button", { name: owner === "todos" ? "Clear same #1" : "Clear first" }));
    } else if (action === "removed-event") {
      if ("store" in fixture) {
        fixture.store.todos = fixture.store.todos.filter(item => item.id !== first);
        app.emit({ actor: USER, name: "todo.deleted", data: { id: 1 } });
      } else {
        fixture.state.pads = fixture.state.pads.filter(item => item.name !== first);
        app.emit({ actor: USER, name: "pad.deleted", data: { name: "first" } });
      }

      await waitFor(() => expect(screen.queryByRole("button", { name: owner === "todos" ? /#1 / : "first" })).toBeNull());
    } else {
      row("first").focus();
      fireEvent.keyDown(row("first"), { key: "d", code: "KeyD" });
      await questionDialog();

      if (action === "deleted") restore();
      await answerQuestion(action !== "cancelled");
      await questionClosed();
    }

    await waitFor(() => expect(screen.queryByText(message("first")) !== null).toBe(action === "refused" || action === "cancelled"));
    expect(screen.getByText(message("second"))).toBeTruthy();
    expect(row("second")).toBeTruthy();
    expect(row("other")).toBeTruthy();
    expect(app.calls.filter(call => call.method === remove).slice(calls).map(call => call.params)).toEqual(action === "deleted" || action === "refused" ? [owner === "todos" ? { id: 1 } : { name: "first" }] : []);
    expect(connected.drafts.list()).toEqual(retained);
    expect(connected.drafts.list().find(item => item.revision === draft.revision)?.value.text).toBe("  unfinished é 🧭\n\nlast  ");
  });
}
