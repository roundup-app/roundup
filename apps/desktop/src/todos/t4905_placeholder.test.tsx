import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo } from "./testHarness";
import { planDrop, treeRows } from "./todoView";

afterEach(cleanup);

const pending = todo(-7, { title: "pending capture" });

it.each([
  ["Open", { key: "Enter", code: "Enter" }],
  ["rename", { key: "F2", code: "F2" }],
  ["complete", { key: "x", code: "KeyX" }],
  ["owner picker", { key: "o", code: "KeyO" }],
  ["owner digit", { key: "1", code: "Digit1" }],
  ["Home", { key: "w", code: "KeyW" }],
  ["comment", { key: "c", code: "KeyC" }],
  ["nest", { key: "Tab", code: "Tab" }],
  ["unnest", { key: "Tab", code: "Tab", shiftKey: true }],
  ["reorder", { key: "ArrowDown", code: "ArrowDown", altKey: true }],
  ["delete", { key: "Backspace", code: "Backspace" }],
  ["bulk selection", { key: "Enter", code: "Enter", metaKey: true }],
] as const)("t4905_pending_rows_cannot_mutate_items_%s", async (_action, key) => {
  const { app, todos, store } = await mountTodos([todo(1)]);
  todos.show(pending);
  const row = await screen.findByText("pending capture");
  row.focus();
  const before = app.calls.length;
  fireEvent.keyDown(row, key);
  const frame = row.closest<HTMLElement>("[data-todo]")!;
  expect(within(frame).queryAllByRole("button")).toEqual([]);
  expect(within(frame).queryByRole("checkbox")).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
  expect(store.todos.map(item => [item.id, item.done, item.title, item.blockers])).toEqual([[1, false, "todo 1", []]]);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("t4905_pending_rows_cannot_mutate_items_blocker_or_bulk_target", async () => {
  const { app, todos } = await mountTodos([todo(1), todo(2)]);
  todos.show(pending);
  fireEvent.keyDown(await screen.findByRole("button", { name: "Idle #1 todo 1" }), { key: "Enter" });
  const drawer = await screen.findByRole("complementary", { name: "Drawer" });
  fireEvent.click(await within(drawer).findByRole("button", { name: /Blocker/ }));
  const input = await screen.findByRole("combobox");
  fireEvent.input(input, { target: { value: "pending" } });
  await waitFor(() => expect(screen.queryAllByRole("option")).toEqual([]));
  fireEvent.keyDown(input, { key: "Enter" });
  expect(todoCallsTo(app, "todo.setBlockers")).toEqual([]);
  expect(todos.byId().has(-7)).toBe(false);
});

it("t4905_pending_rows_cannot_mutate_items_drag_and_reorder", async () => {
  const { todos, app } = await mountTodos([todo(1), todo(2), todo(3)]);
  todos.show(pending);
  const real = [...todos.all()];
  const rows = treeRows(real);
  // These are the existing drag planner inputs used by the connected list.
  expect(planDrop(rows, real, real, -7, null, 1)).toEqual({});
  expect(planDrop(rows, real, real, 1, -7, 1)).toEqual({});
  expect(planDrop(rows, real, real, 1, null, 1)).toEqual({ before: 3 });
  const row = await screen.findByRole("button", { name: "Idle #1 todo 1" });
  row.focus();
  fireEvent.keyDown(row, { key: "ArrowDown", code: "ArrowDown", altKey: true });
  await waitFor(() => expect(todoCallsTo(app, "todo.reorder").map(call => call.params)).toEqual([{ id: 1, before: 3 }]));
  expect(app.calls.some(call => JSON.stringify(call.params).includes("-7"))).toBe(false);
});
