import { batch } from "solid-js";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo } from "../todos/testHarness";
import { deferred, openShelf, padOf } from "../pads/padsFixture";
import { RpcError } from "../app/seam";
import { USER } from "../testing/nodes";
import { stubDialogLayout, askToDelete, questionClosed } from "./bulkQuestionHarness";

afterEach(() => batch(cleanup));

stubDialogLayout();

const pickTwo = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #2 / }), { metaKey: true });
};

it("u460_each_confirmed_target_is_called_once", async () => {
  const { app, store } = await mountTodos([todo(1), todo(2)]);
  const kept = deferred<null>();
  app.handlers["todo.delete"] = async (params) => {
    if (params.ids[0] === 1) await kept.promise;
    store.todos = store.todos.filter((row) => !params.ids.includes(row.id));

    return { operation: params.operation, deleted: params.ids, missing: [], state: "deleted" };
  };

  await pickTwo();
  await askToDelete(2);
  expect(todoCallsTo(app, "todo.delete")).toHaveLength(1);
  kept.resolve(null);
  await questionClosed();
  expect(todoCallsTo(app, "todo.delete").map((call) => call.params)).toEqual([{ operation: expect.any(String), ids: [1, 2] }]);
});

it("u460_partial_failure_names_and_selects_only_failed_rows", async () => {
  const { app, store } = await mountTodos([todo(1, { title: "same" }), todo(2, { title: "same" })]);
  app.handlers["todo.delete"] = (params) => {
    store.todos = store.todos.filter((row) => row.id !== 1);

    return { operation: params.operation, deleted: [1], missing: [2], state: "deleted" };
  };

  await pickTwo();
  await askToDelete(2);
  await screen.findByText("Could not delete same #2: The chosen Todo is no longer available. Retry to check again.");
  expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / })).toBeNull();
  expect(screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #2 / }).getAttribute("aria-pressed")).toBe("true");
});

it("u460_lost_response_refetches_before_retry", async () => {
  const { app } = await mountTodos([todo(1), todo(2)]);
  const remove = app.handlers["todo.delete"]!;
  app.handlers["todo.delete"] = async params => { await remove(params); throw new Error("response lost"); };

  await pickTwo();
  await askToDelete(2);
  await questionClosed();
  expect(screen.queryByRole("button", { name: /^(?:Idle|Blocked|Done) (?:#1 |#2 )/ })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});


it("u460_confirmation_never_expands_or_outlives_its_scope", async () => {
  const { app, store, connected } = await mountTodos([todo(1), todo(2)]);
  await pickTwo();
  await askToDelete(2);
  store.todos.push(todo(3));
  app.emit({ actor: USER, name: "todo.created", data: todo(3) });
  await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #3 / });
  connected.rail.select("scope-row");
  await questionClosed();
  expect(todoCallsTo(app, "todo.delete").map(call => call.params)).toEqual([{ operation: expect.any(String), ids: [1, 2] }]);
});

it("u460_backspace_is_local_and_repeat_safe", async () => {
  const { app } = await mountTodos([todo(1), todo(2)]);
  await pickTwo();
  const row = screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / });
  row.focus();
  fireEvent.keyDown(row, { key: "Backspace", repeat: true });
  fireEvent.keyDown(row, { key: "Backspace", metaKey: true });
  fireEvent.keyDown(screen.getByRole("checkbox", { name: "Complete todo 1" }), { key: "Backspace" });
  expect([screen.queryByRole("button", { name: "Keep" })]).toEqual([null]);
  fireEvent.keyDown(row, { key: "Backspace" });
  expect(todoCallsTo(app, "todo.delete").map(call => call.params)).toEqual([{ operation: expect.any(String), ids: [1, 2] }]);
});

it("u460_retry_confirms_only_the_remaining_set", async () => {
  const { app, store } = await mountTodos([todo(1), todo(2)]);
  let failed = true;
  app.handlers["todo.delete"] = (params) => {
    store.todos = store.todos.filter((row) => (failed ? row.id !== 1 : row.id !== 2));

    return { operation: params.operation, deleted: failed ? [1] : [2], missing: failed ? [2] : [], state: "deleted" };
  };

  await pickTwo();
  await askToDelete(2);
  await screen.findByText("Could not delete todo 2 #2: The chosen Todo is no longer available. Retry to check again.");
  failed = false;
  await askToDelete(1);
  await questionClosed();
  expect(todoCallsTo(app, "todo.delete").map((call) => call.params)).toEqual([{ operation: expect.any(String), ids: [1, 2] }, { operation: expect.any(String), ids: [2] }]);
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
  await screen.findByRole("button", { name: "Retry" });
  expect(screen.getByRole("button", { name: "Delete 2" }).hasAttribute("disabled")).toBe(true);
  lost = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("2 selected");
  expect(todoCallsTo(app, "todo.delete")).toHaveLength(1);
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
  await waitFor(() => expect(reads).toBe(1));
  app.emit({ actor: USER, name: "todo.updated", data: todo(2) });
  await waitFor(() => expect(reads).toBe(2));
  old.resolve([todo(1), todo(2)]);
  // Observe that no retry is offered while the newer list response is stale.
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(screen.getByRole("button", { name: "Delete 2" }).hasAttribute("disabled")).toBe(true);
  fresh.resolve([todo(2)]);
  await waitFor(() => expect(screen.queryByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / })).toBeNull());
  await questionClosed();
  expect(screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #2 / }).getAttribute("aria-pressed")).toBe("true");
});

it("u460_plain_click_after_failure_clears_the_bar_before_opening_the_drawer", async () => {
  const { app } = await mountTodos([todo(1), todo(2)]);
  app.handlers["todo.delete"] = () => { throw new Error("denied"); };

  await pickTwo();
  await askToDelete(2);
  await screen.findByText("Could not delete todo 1 #1: denied");
  const focusedRow = screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / });
  focusedRow.focus();
  fireEvent.keyDown(focusedRow, { key: "Enter", code: "Enter" });
  expect(screen.getByRole<HTMLElement>("complementary").inert).toBe(false);
});

it.each([false, true])("u3474e_mutation_keeps_the_next_key_live: nested=%s", async nested => {
  const initial = nested ? [todo(1), todo(2), todo(3), todo(4, { blockers: [5] }), todo(5), todo(6)] : [todo(1), todo(2), todo(3)];
  const id = nested ? 3 : 2;
  const next = nested ? 5 : 3;
  const { app } = await mountTodos(initial);
  const row = await screen.findByRole("button", { name: new RegExp(`^(Idle|Blocked|Done) #${id} `) });
  row.focus();
  fireEvent.keyDown(row, { key: "d", code: "KeyD" });
  await questionClosed();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: new RegExp(`^(Idle|Blocked|Done) #${next} `) })));
  fireEvent.keyDown(document.activeElement!, { key: "d", code: "KeyD" });
  await questionClosed();
  expect(todoCallsTo(app, "todo.delete").map(call => call.params)).toEqual([{ operation: expect.any(String), ids: [id] }, { operation: expect.any(String), ids: [next] }]);
});

it("u460_refresh_shows_only_after_a_failed_readback", async () => {
  const { app } = await mountTodos([todo(1), todo(2)]);
  const kept = deferred<null>();
  app.handlers["todo.delete"] = async () => {
    await kept.promise;
    throw new RpcError(-32001, "denied");
  };

  await pickTwo();
  await askToDelete(2);
  expect([screen.queryByRole("button", { name: "Retry" })]).toEqual([null]);
  kept.resolve(null);
  await screen.findAllByText(/denied/);
  expect([screen.queryByRole("button", { name: "Retry" })]).toEqual([null]);
});

// BulkDelete owns deletion only; save acknowledgements belong to the item editors.
for (const owner of ["todos", "pads"] as const) {
  it.each(["deleted", "removed-event", "refused", "dismissed", "readback-unrelated"] as const)(`p3557c_failure_lifetime_shelf_${owner}_%s`, async action => {
    const fixture = owner === "todos"
      ? await mountTodos([todo(1, { title: "same" }), todo(2, { title: "same" }), todo(3)])
      : await openShelf([padOf("first", USER), padOf("second", USER), padOf("other", USER)]);

    const { app, connected } = fixture;
    const first = owner === "todos" ? 1 : "first";
    const row = (which: "first" | "second" | "other") => screen.getByRole("button", { name: owner === "todos" ? new RegExp(`^(Idle|Blocked|Done) #${{ first: 1, second: 2, other: 3 }[which]} `) : which });
    const message = (which: "first" | "second") => owner === "todos" ? `Could not delete same #${which === "first" ? 1 : 2}: denied` : `Could not delete ${which}: denied`;
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
    await screen.findByRole("button", { name: owner === "todos" ? /^(Idle|Blocked|Done) #1 / : "first" });
    fireEvent.click(row("first"), { metaKey: true });
    fireEvent.click(row("second"), { metaKey: true });
    await askToDelete(2);
      await screen.findByText(message("first"));
    await screen.findByText(message("second"));
    const calls = app.calls.filter(call => call.method === remove).length;

    if (action === "readback-unrelated") {
      const listTodos = app.handlers["todo.list"];
      const listPads = app.handlers["pad.list"];
      const readbackError = new Error("list unavailable");
      app.handlers[owner === "todos" ? "todo.list" : "pad.list"] = () => { throw readbackError; };

      row("first").focus();
      fireEvent.keyDown(row("first"), { key: "d", code: "KeyD" });
          await screen.findByRole("button", { name: "Retry" });

      if (listTodos) app.handlers["todo.list"] = listTodos;

      if (listPads) app.handlers["pad.list"] = listPads;

      if ("store" in fixture) {
        fixture.store.todos = fixture.store.todos.filter(item => item.id !== 3);
        app.emit({ actor: USER, name: "todo.deleted", data: { id: 3 } });
      } else {
        fixture.state.pads = fixture.state.pads.filter(item => item.name !== "other");
        app.emit({ actor: USER, name: "pad.deleted", data: { name: "other" } });
      }

      await waitFor(() => expect(screen.queryByRole("button", { name: owner === "todos" ? /^(Idle|Blocked|Done) #3 / : "other" })).toBeNull());
      expect(within(screen.getByRole("group", { name: "Bench deletion" })).getByRole("alert").textContent).toContain(readbackError.message);
      expect(connected.drafts.list()).toEqual(retained);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
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

      await waitFor(() => expect(screen.queryByRole("button", { name: owner === "todos" ? /^(Idle|Blocked|Done) #1 / : "first" })).toBeNull());
    } else {
      if (action === "deleted") restore();
      row("first").focus();
      fireEvent.keyDown(row("first"), { key: "d", code: "KeyD" });
      await questionClosed();
    }

    await waitFor(() => expect(screen.queryByText(message("first")) !== null).toBe(action === "refused"));
    expect(screen.getByText(message("second"))).toBeTruthy();
    expect(row("second")).toBeTruthy();
    expect(row("other")).toBeTruthy();
    expect(app.calls.filter(call => call.method === remove).slice(calls).map(call => call.params)).toEqual(action === "deleted" || action === "refused" ? [owner === "todos" ? { operation: expect.any(String), ids: [1] } : { name: "first", expectedIncarnation: "fixture-first", operation: expect.any(String) }] : []);
    expect(connected.drafts.list()).toEqual(retained);
    expect(connected.drafts.list().find(item => item.revision === draft.revision)?.value.text).toBe("  unfinished é 🧭\n\nlast  ");
  });
}
