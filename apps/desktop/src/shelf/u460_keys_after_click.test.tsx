import { batch } from "solid-js";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo } from "../todos/testHarness";
import { AGENT, openShelf, padOf } from "../pads/padsFixture";
import { stubDialogLayout } from "./bulkQuestionHarness";

afterEach(() => batch(cleanup));

stubDialogLayout();

const leaveFocus = (row: HTMLElement) => { row.blur(); expect(document.activeElement).toBe(document.body); };

it("u460_backspace_after_a_click_deletes_the_todo_when_focus_is_on_the_page", async () => {
  const { app, store } = await mountTodos([todo(1), todo(2)]);
  app.handlers["todo.delete"] = (params) => {
    store.todos = store.todos.filter((row) => !params.ids.includes(row.id));

    return { operation: params.operation, deleted: params.ids, missing: [], state: "deleted" };
  };

  const row = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / });
  fireEvent.click(row);
  leaveFocus(row);
  fireEvent.keyDown(document.body, { key: "Backspace" });
  await waitFor(() => expect(todoCallsTo(app, "todo.delete").map((call) => call.params)).toEqual([{ operation: expect.any(String), ids: [1] }]));
});

it("u460_backspace_after_a_click_deletes_the_pad_when_focus_is_on_the_page", async () => {
  const { app } = await openShelf([padOf("a", AGENT), padOf("b", AGENT)]);
  const row = await screen.findByRole("button", { name: "a" });
  fireEvent.click(row);
  leaveFocus(row);
  fireEvent.keyDown(document.body, { key: "Backspace" });
  await waitFor(() => expect(app.calls.filter((call) => call.method === "pad.delete").map((call) => call.params)).toEqual([expect.objectContaining({ name: "a" })]));
});
