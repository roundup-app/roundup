import { batch } from "solid-js";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo } from "../todos/testHarness";
import { AGENT, openShelf, padOf } from "../pads/padsFixture";
import { stubDialogLayout } from "./bulkQuestionHarness";

afterEach(() => batch(cleanup));

stubDialogLayout();

const todoRow = (id: number) => screen.queryByRole("button", { name: new RegExp(`^(?:Idle|Blocked|Done) #${id} `) });

it("u6455a_backspace_keeps_deleting_the_next_row", async () => {
  const { app, store } = await mountTodos([todo(1), todo(2), todo(3)]);
  app.handlers["todo.delete"] = (params) => {
    store.todos = store.todos.filter((row) => !params.ids.includes(row.id));

    return { operation: params.operation, deleted: params.ids, missing: [], state: "deleted" };
  };

  fireEvent.click(await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }));
  fireEvent.keyDown(todoRow(1)!, { key: "Backspace" });
  await waitFor(() => expect(todoRow(2)?.getAttribute("aria-pressed")).toBe("true"));
  fireEvent.keyDown(todoRow(2)!, { key: "Backspace" });
  await waitFor(() => expect(todoRow(3)?.getAttribute("aria-pressed")).toBe("true"));
  expect(todoCallsTo(app, "todo.delete").map((call) => call.params)).toEqual([[1], [2]].map((ids) => ({ operation: expect.any(String), ids })));
  expect(document.activeElement).toBe(todoRow(3));
  expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
});

it("u6455a_backspace_keeps_deleting_the_next_row_in_pads", async () => {
  const { app } = await openShelf([padOf("a", AGENT), padOf("b", AGENT), padOf("c", AGENT)]);
  fireEvent.click(await screen.findByRole("button", { name: "a" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "a" }), { key: "Backspace" });
  await waitFor(() => expect(screen.getByRole("button", { name: "b" }).getAttribute("aria-pressed")).toBe("true"));
  fireEvent.keyDown(screen.getByRole("button", { name: "b" }), { key: "Backspace" });
  await waitFor(() => expect(screen.getByRole("button", { name: "c" }).getAttribute("aria-pressed")).toBe("true"));
  expect(app.calls.filter((call) => call.method === "pad.delete").map((call) => call.params)).toEqual(["a", "b"].map((name) => expect.objectContaining({ name })));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "c" }));
});

it("u6455a_last_row_deleted_leaves_nothing_selected", async () => {
  const { app, store } = await mountTodos([todo(1)]);
  app.handlers["todo.delete"] = (params) => {
    store.todos = [];

    return { operation: params.operation, deleted: params.ids, missing: [], state: "deleted" };
  };

  fireEvent.click(await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }));
  fireEvent.keyDown(todoRow(1)!, { key: "Backspace" });
  await waitFor(() => expect(todoRow(1)).toBeNull());
  expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
});

it("u6455a_partial_failure_selects_only_failed_rows", async () => {
  const { app, store } = await mountTodos([todo(1), todo(2), todo(3)]);
  app.handlers["todo.delete"] = (params) => {
    store.todos = store.todos.filter((row) => row.id !== 1);

    return { operation: params.operation, deleted: [1], missing: [2], state: "deleted" };
  };

  fireEvent.click(await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }));
  fireEvent.click(todoRow(2)!, { metaKey: true });
  fireEvent.keyDown(todoRow(2)!, { key: "Backspace" });
  await screen.findByText(/Could not delete/);
  await waitFor(() => expect(todoRow(1)).toBeNull());
  expect(todoRow(3)!.getAttribute("aria-pressed")).not.toBe("true");
  expect(todoRow(2)!.getAttribute("aria-pressed")).toBe("true");
});
