import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { mountTodos, todo, todoCallsTo as callsTo, todoEvent } from "./testHarness";

afterEach(cleanup);

const openField = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));

  return screen.getByRole("textbox", { name: "New Todo title" });
};

const type = (field: HTMLElement, text: string) => fireEvent.input(field, { target: { value: text } });

describe("u16 create a Todo", () => {
  it("u16_clicking_plus_opens_one_title_field_in_a_row_after_the_last_todo", async () => {
    await mountTodos([todo(1), todo(2)]);

    const field = await openField();

    expect(screen.getByText("todo 2").compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("u16_clicking_plus_twice_still_shows_one_field", async () => {
    await mountTodos([]);
    await openField();

    fireEvent.click(screen.getByRole("button", { name: "Add Todo" }));

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("u16_clicking_plus_while_typing_keeps_the_typed_text", async () => {
    await mountTodos([]);
    type(await openField(), "half a thought");

    fireEvent.click(screen.getByRole("button", { name: "Add Todo" }));

    expect(screen.getByRole("textbox", { name: "New Todo title" })).toHaveProperty("value", "half a thought");
  });

  it("u16_enter_calls_todo_create_with_the_title_and_leaves_a_fresh_focused_field", async () => {
    const { app } = await mountTodos([]);
    app.handlers["todo.create"] = ({ title }) => todo(1, { title });
    const field = await openField();
    type(field, "  rate limits ");

    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(callsTo(app, "todo.create")).toEqual([
      { method: "todo.create", params: { title: "rate limits", body: null, blockers: null } },
    ]));
    expect(field).toHaveProperty("value", "");
    expect(document.activeElement).toBe(field);
  });

  it("u16_the_new_row_appears_through_the_event_not_the_call", async () => {
    const { app, store } = await mountTodos([]);
    app.handlers["todo.create"] = ({ title }) => todo(1, { title });
    const field = await openField();
    type(field, "rate limits");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(callsTo(app, "todo.create")).toHaveLength(1));
    const before = screen.queryByText(/rate limits/);

    store.todos = [todo(1, { title: "rate limits" })];
    app.emit(todoEvent("todo.created", todo(1)));

    expect([before, await screen.findByText(/rate limits/)].map(Boolean)).toEqual([false, true]);
  });

  it("u16_escape_closes_the_field_calls_nothing_and_refocuses_plus", async () => {
    const { app } = await mountTodos([]);
    const field = await openField();
    type(field, "half a thought");

    fireEvent.keyDown(field, { key: "Escape" });

    expect([screen.queryByRole("textbox"), callsTo(app, "todo.create")]).toEqual([null, []]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add Todo" }));
  });

  it("u16_blur_closes_an_empty_field_and_keeps_a_typed_one", async () => {
    await mountTodos([]);
    const field = await openField();

    fireEvent.blur(field);

    expect(screen.queryByRole("textbox")).toBeNull();

    type(await openField(), "half a thought");
    fireEvent.blur(screen.getByRole("textbox"));

    expect(screen.getByRole("textbox")).toHaveProperty("value", "half a thought");
  });

  it.each(["", "   "])("u16_enter_on_the_empty_title_%j_closes_the_field_and_calls_nothing", async (text) => {
    const { app } = await mountTodos([]);
    const field = await openField();
    type(field, text);

    fireEvent.keyDown(field, { key: "Enter" });

    expect([screen.queryByRole("textbox"), callsTo(app, "todo.create")]).toEqual([null, []]);
  });

  it("u16_a_failed_create_shows_the_message_and_keeps_the_field", async () => {
    const { app } = await mountTodos([]);
    app.handlers["todo.create"] = () => Promise.reject(new RpcError(-32602, "title is empty"));
    const field = await openField();
    type(field, "x");

    fireEvent.keyDown(field, { key: "Enter" });

    expect([(await screen.findByText(/title is empty/)).textContent, screen.queryByRole("textbox")]).toEqual([
      "title is empty",
      screen.getByRole("textbox"),
    ]);
  });

  it("u16_plus_after_a_failure_replaces_the_message_with_a_fresh_field", async () => {
    const { app } = await mountTodos([]);
    app.handlers["todo.create"] = () => Promise.reject(new RpcError(-32602, "title is empty"));
    const field = await openField();
    type(field, "x");
    fireEvent.keyDown(field, { key: "Enter" });
    await screen.findByText(/title is empty/);

    fireEvent.click(screen.getByRole("button", { name: "Add Todo" }));

    expect([screen.queryByText(/title is empty/), screen.getAllByRole("textbox")]).toEqual([null, [expect.anything()]]);
  });

  it("u16_a_create_that_fails_after_a_second_field_was_opened_keeps_that_field_and_its_text_and_shows_the_message", async () => {
    const { app } = await mountTodos([]);
    let reject = (_failure: Error) => {};

    app.handlers["todo.create"] = () =>
      new Promise((_, fail) => {
        reject = fail;
      });

    const first = await openField();
    type(first, "x");
    fireEvent.keyDown(first, { key: "Enter" });
    type(await openField(), "second thought");

    reject(new RpcError(-32602, "title is empty"));

    await waitFor(() => expect(callsTo(app, "todo.create")).toHaveLength(1));
    await new Promise((settle) => setTimeout(settle));
    expect(screen.getByRole("textbox", { name: "New Todo title" })).toHaveProperty("value", "second thought");
    expect(screen.getByText(/title is empty/).textContent).toBe("title is empty");
  });

  it("u16_the_next_enter_clears_a_shown_failure", async () => {
    const { app } = await mountTodos([]);
    app.handlers["todo.create"] = () => Promise.reject(new RpcError(-32602, "title is empty"));
    const first = await openField();
    type(first, "x");
    fireEvent.keyDown(first, { key: "Enter" });
    await screen.findByText(/title is empty/);
    const second = await openField();

    fireEvent.keyDown(second, { key: "Escape" });

    expect(screen.queryByText(/title is empty/)).toBeNull();
  });
});
