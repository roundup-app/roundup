import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent } from "../testing/nodes";
import { HELP_ROWS, hintsFor } from "../keys/chords";
import { mountTodos, todo, todoEvent, todoCallsTo } from "./testHarness";

afterEach(cleanup);

const owner = { kind: "agent" as const, id: "a", parent: null };

const agents = [agent("a", "idle", "", { name: "Writer" })];

const row = () => screen.getByRole("button", { name: "Idle #1 todo 1" });

const key = (key: string, code = key, modifiers = {}) => fireEvent.keyDown(document.activeElement!, { key, code, ...modifiers });

it("u3309_a_digit_without_an_agent_or_for_the_own_owner_calls_nothing", async () => {
  const { app } = await mountTodos([todo(1, { owner })], true, agents);
  (await screen.findByRole<HTMLElement>("button", { name: "Idle #1 todo 1" })).focus();
  key("1", "Digit1");
  key("9", "Digit9");
  expect(todoCallsTo(app, "todo.assign")).toEqual([]);
});

it("u3309_enter_arrows_enter_assigns_once_and_esc_cancels", async () => {
  const { app } = await mountTodos([todo(1)], true, agents);
  (await screen.findByRole<HTMLElement>("button", { name: "Idle #1 todo 1" })).focus();
  key("Enter");
  key("ArrowUp");
  expect(screen.getByRole("status").textContent).toBe("Move #1 to Writer");
  key("Escape");
  expect(todoCallsTo(app, "todo.assign")).toEqual([]);
  key("Enter");
  key("ArrowUp");
  key("Enter");
  await waitFor(() => expect(todoCallsTo(app, "todo.assign")).toEqual([{ method: "todo.assign", params: { id: 1, owner } }]));
});

it("u3309_focus_returns_to_the_row", async () => {
  const { app, store } = await mountTodos([todo(1)], true, agents);
  (await screen.findByRole<HTMLElement>("button", { name: "Idle #1 todo 1" })).focus();
  key("1", "Digit1");
  await waitFor(() => expect(todoCallsTo(app, "todo.assign")).toHaveLength(1));
  app.emit(todoEvent("todo.updated", store.todos[0]!));
  await waitFor(() => expect(document.querySelector('[data-shelf-group="a"] [data-todo="1"]')).toBeTruthy());
  await waitFor(() => expect(document.activeElement).toBe(row()));
});

it("u3309_the_keys_are_inert_in_fields_with_modifiers_and_on_done_rows", async () => {
  const { app } = await mountTodos([todo(1), todo(2, { done: true })], true, agents);
  (await screen.findByRole<HTMLElement>("button", { name: "Idle #1 todo 1" })).focus();

  for (const modifier of ["shiftKey", "metaKey", "ctrlKey", "altKey"]) {
    key("1", "Digit1", { [modifier]: true });
    key("Enter", "Enter", { [modifier]: true });
  }

  fireEvent.click(screen.getByRole("button", { name: "add todo to Overview" }));
  (await screen.findByRole<HTMLElement>("textbox", { name: "New Todo title" })).focus();
  key("1", "Digit1");
  fireEvent.click(screen.getByRole("button", { name: /1 done/ }));
  screen.getByRole("button", { name: "Done #2 todo 2" }).focus();
  key("1", "Digit1");
  key("Enter");
  expect(todoCallsTo(app, "todo.assign")).toEqual([]);
});

it("u3309_a_digit_assigns_to_that_agent_once", async () => {
  const { app } = await mountTodos([todo(1)], true, agents);
  (await screen.findByRole<HTMLElement>("button", { name: "Idle #1 todo 1" })).focus();
  key("1", "Digit1");
  await waitFor(() => expect(todoCallsTo(app, "todo.assign")).toEqual([{ method: "todo.assign", params: { id: 1, owner } }]));
  expect(HELP_ROWS.some(row => row.keys === "1–9")).toBe(true);
  expect(hintsFor("shelf").some(row => row.keys === "1–9")).toBe(true);
});

it("u3309_a_refused_assign_keeps_the_group_and_shows_the_cause", async () => {
  const { app } = await mountTodos([todo(1)], true, agents);
  app.handlers["todo.assign"] = () => { throw new RpcError(-32004, "owner removed"); };

  (await screen.findByRole<HTMLElement>("button", { name: "Idle #1 todo 1" })).focus();
  key("1", "Digit1");
  expect(await screen.findByText(/owner removed/)).toBeTruthy();
  expect(row().closest("[data-shelf-group]")?.getAttribute("data-shelf-group")).toBe("unassigned");
});
