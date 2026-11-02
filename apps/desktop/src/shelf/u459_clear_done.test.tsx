import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo } from "../todos/testHarness";
import { SCOPE_ROW } from "../testing/nodes";
import { confirmDeletion, questionClosed, stubDialogLayout } from "./bulkQuestionHarness";

afterEach(cleanup);

stubDialogLayout();

it("u459_clear_done_targets_only_the_scoped_done_set", async () => {
  const { app, connected } = await mountTodos([todo(1, { done: true, home: SCOPE_ROW }), todo(2, { done: true, home: SCOPE_ROW }), todo(3, { done: true }), todo(4, { home: SCOPE_ROW })]);
  connected.rail.select("scope-row");
  fireEvent.click(await screen.findByRole("button", { name: "Clear done" }));
  await questionClosed();
  expect(todoCallsTo(app, "todo.delete").map(call => call.params)).toEqual([{ operation: expect.any(String), ids: [1, 2] }]);
});


it("u459_clear_done_success_removes_only_done_rows", async () => {
  const { app } = await mountTodos([todo(1, { done: true }), todo(2, { done: true }), todo(3)]);
  fireEvent.click(await screen.findByRole("button", { name: "Clear done" }));
  await confirmDeletion();
  await questionClosed();
  expect(todoCallsTo(app, "todo.delete").map((call) => call.params)).toEqual([{ operation: expect.any(String), ids: [1, 2] }]);
  expect(screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #3 / })).toBeTruthy();
});

it("u459_failed_done_rows_are_visible_and_selected", async () => {
  const { app, store } = await mountTodos([todo(1, { done: true }), todo(2, { done: true })]);
  app.handlers["todo.delete"] = (params) => {

    store.todos = store.todos.filter((row) => row.id !== params.ids[0]);

    return { operation: params.operation, deleted: [1], missing: [2], state: "deleted" };
  };

  fireEvent.click(await screen.findByRole("button", { name: "Clear done" }));
  await confirmDeletion();
  await screen.findByText("Could not delete todo 2 #2: The chosen Todo is no longer available. Retry to check again.");
  await questionClosed();
  expect(screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #2 / }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
});
