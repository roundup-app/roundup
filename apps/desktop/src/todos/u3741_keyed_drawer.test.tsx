import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { mountTodos, todo, todoCallsTo, todoEvent } from "./testHarness";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const open = async (id: number) => {
  const row = await screen.findByRole("button", { name: new RegExp(`^Idle #${id} `) });
  row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  await within(panel()).findByRole("region", { name: "Activity" });
};

const next = () => within(panel()).getByRole("button", { name: "Next Todo" });

it("u3741_moving_to_another_todo_shows_no_failure_from_the_previous_one", async () => {
  const m = await mountTodos([todo(1), todo(2)]);
  const original = m.app.handlers["todo.getHistory"];
  m.app.handlers["todo.getHistory"] = params => params.id === 1 || !original ? Promise.reject(new RpcError(-32003, "History unavailable")) : original(params);
  await open(1);
  await within(panel()).findByText("History unavailable");
  fireEvent.click(next());
  await waitFor(() => expect(todoCallsTo(m.app, "todo.getHistory").map(call => call.params)).toContainEqual({ id: 2 }));
  await waitFor(() => expect(within(panel()).queryAllByText(/History unavailable/)).toHaveLength(0));
});

it("u462_history_is_marked_read_once_per_drawer", async () => {
  const m = await mountTodos([todo(1)]);
  await open(1);
  const toggle = async () => fireEvent.click(await within(panel()).findByRole("button", { name: /^\d+ changes?$/ }));
  await toggle();
  await waitFor(() => expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(1));
  await toggle();
  await toggle();
  m.app.emit(todoEvent("todo.updated", m.store.todos[0] ?? todo(1)));
  await waitFor(() => expect(todoCallsTo(m.app, "todo.getHistory")).toHaveLength(2));
  expect(todoCallsTo(m.app, "todo.readHistory").map(call => call.params)).toEqual([{ id: 1, through: 1 }]);
});

it("u3741_a_failure_clears_on_the_events_doesClearTodoFailure_names", async () => {
  const m = await mountTodos([todo(1)]);
  m.app.clipboardWrite = () => Promise.reject(new Error("Clipboard refused"));
  await open(1);
  fireEvent.click(await within(within(panel()).getByRole("region", { name: "Activity" })).findByRole("button", { name: "Copy" }));
  await within(panel()).findByText(/Clipboard refused/);
  m.app.emit(todoEvent("todo.updated", m.store.todos[0] ?? todo(1)));
  await waitFor(() => expect(within(panel()).queryAllByText(/Clipboard refused/)).toHaveLength(0));
});

it("u3741_scroll_and_inner_focus_survive_moving_between_todos", async () => {
  const m = await mountTodos([todo(1), todo(2)]);
  await open(1);
  const scroller = panel();
  fireEvent.click(next());
  await waitFor(() => expect(todoCallsTo(m.app, "todo.getHistory").map(call => call.params)).toContainEqual({ id: 2 }));
  await within(panel()).findByRole("region", { name: "Activity" });
  expect(panel()).toBe(scroller);
});
