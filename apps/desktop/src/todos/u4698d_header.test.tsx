import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { stubDialogLayout } from "../shelf/bulkQuestionHarness";
import { mountTodos, todo, todoCallsTo } from "./testHarness";
import { TodoHost } from "./TodoDrawer";

afterEach(cleanup);

stubDialogLayout();

it("u4698d_header_navigates_the_visible_order_without_mutating", async () => {
  const { app, store, todos } = await mountTodos([todo(7), todo(3), todo(9), todo(4, { done: true })]);
  store.todos = [store.todos.find(todo => todo.id === 7)!, store.todos.find(todo => todo.id === 3)!, store.todos.find(todo => todo.id === 9)!, store.todos.find(todo => todo.id === 4)!];
  await todos.reload();
  { const row = await screen.findByRole("button", { name: "Idle #3 todo 3" }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  const panel = screen.getByRole("complementary", { name: "Drawer" });
  fireEvent.click(await within(panel).findByRole("button", { name: "Previous Todo" }));
  await within(panel).findByRole("checkbox", { name: "Complete todo 7" });
  expect(within(panel).getByRole<HTMLButtonElement>("button", { name: "Previous Todo" }).disabled).toBe(true);
  fireEvent.click(within(panel).getByRole("button", { name: "Next Todo" }));
  await within(panel).findByRole("checkbox", { name: "Complete todo 3" });
  fireEvent.click(within(panel).getByRole("button", { name: "Next Todo" }));
  await within(panel).findByRole("checkbox", { name: "Complete todo 9" });
  expect(within(panel).getByRole<HTMLButtonElement>("button", { name: "Next Todo" }).disabled).toBe(true);
  expect(todoCallsTo(app, "todo.get").map(call => call.params)).toEqual([{ id: 7 }, { id: 3 }, { id: 9 }]);
  expect(todoCallsTo(app, "todo.update")).toEqual([]);
  expect(todoCallsTo(app, "todo.assign")).toEqual([]);
});

it("u4698d_header_copies_only_the_displayed_identity", async () => {
  const { app } = await mountTodos([todo(3)]);
  { const row = await screen.findByRole("button", { name: "Idle #3 todo 3" }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  const panel = screen.getByRole("complementary", { name: "Drawer" });
  fireEvent.click(await within(panel).findByRole("button", { name: "Copy Todo id" }));
  await waitFor(() => expect(app.clipboardWrites).toEqual(["#3"]));
  expect(app.calls.filter(call => ["todo.update", "todo.assign", "agent.spawn", "terminal.spawn", "agent.prompt"].includes(call.method))).toEqual([]);
});

it.each([null, "low", "medium", "high", "urgent"] as const)("u4698d_meta_changes_only_the_selected_priority_%s", async priority => {
  const { app } = await mountTodos([todo(3, { priority })]);
  { const row = await screen.findByRole("button", { name: "Idle #3 todo 3" }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  const panel = screen.getByRole("complementary", { name: "Drawer" });
  fireEvent.click(await within(panel).findByRole("button", { name: "Priority" }));
  const next = priority === null ? "urgent" : null;
  fireEvent.click(await screen.findByRole("menuitem", { name: next === null ? "No priority" : "Urgent" }));
  await waitFor(() => expect(todoCallsTo(app, "todo.update")).toEqual([{ method: "todo.update", params: { id: 3, title: null, body: null, priority: next } }]));
});

it("u4698d_blocking_changes_the_dependent_edge_and_keeps_its_other_blockers", async () => {
  const { app } = await mountTodos([todo(1), todo(2, { blockers: [3] }), todo(3)]);
  { const row = await screen.findByRole("button", { name: "Idle #1 todo 1" }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  const panel = screen.getByRole("complementary", { name: "Drawer" });
  fireEvent.click(await within(panel).findByRole("button", { name: /^Blocking/ }));
  fireEvent.click(await screen.findByRole("option", { name: /#2/ }));
  await waitFor(() => expect(todoCallsTo(app, "todo.setBlockers")).toEqual([{ method: "todo.setBlockers", params: { id: 2, blockers: [3, 1], expected_change: 2 } }]));
});

it("u4698d_more_actions_escape_returns_focus_without_mutating", async () => {
  const { app } = await mountTodos([todo(3)]);
  { const row = await screen.findByRole("button", { name: "Idle #3 todo 3" }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  const panel = screen.getByRole("complementary", { name: "Drawer" });
  const more = await within(panel).findByRole("button", { name: "More actions" });
  more.focus(); fireEvent.click(more);
  const menu = await screen.findByRole("menu");
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(more));
  expect(todoCallsTo(app, "todo.delete")).toEqual([]);
});

it("u2773a_todos_header_navigation_keeps_the_exact_title_draft", async () => {
  const { app, connected } = await mountTodos([todo(1), todo(2)]);
  { const row = await screen.findByRole("button", { name: "Idle #1 todo 1" }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  const panel = screen.getByRole("complementary", { name: "Drawer" });
  fireEvent.dblClick(await within(panel).findByText("todo 1", { selector: "p" }));
  const field = within(panel).getByRole("textbox", { name: "Title" });
  const text = "  unfinished e\u0301 🧭  ";
  fireEvent.input(field, { target: { value: text } });
  const drafts = connected.drafts.list();
  const next = within(panel).getByRole("button", { name: "Next Todo" });
  fireEvent.blur(field, { relatedTarget: next });
  fireEvent.click(next);
  await within(panel).findByRole("checkbox", { name: "Complete todo 2" });
  fireEvent.click(within(panel).getByRole("button", { name: "Previous Todo" }));
  fireEvent.dblClick(await within(panel).findByText("todo 1", { selector: "p" }));
  expect(within(panel).getByRole("textbox", { name: "Title" })).toHaveProperty("value", text);
  expect(connected.drafts.list()).toEqual(drafts);
  expect(todoCallsTo(app, "todo.update")).toEqual([]);
  expect(todoCallsTo(app, "todo.get").map(call => call.params)).toEqual([{ id: 2 }, { id: 1 }]);
});


it("u4698d_header_without_a_list_navigates_only_the_current_home", async () => {
  const { app, connected } = await mountTodos([todo(1), todo(2, { home: "other-home" }), todo(3)]);
  connected.drawer.open(() => <TodoHost id={1} />, "key");
  const panel = screen.getByRole("complementary", { name: "Drawer" });
  fireEvent.click(await within(panel).findByRole("button", { name: "Next Todo" }));
  await within(panel).findByRole("checkbox", { name: "Complete todo 3" });
  expect(todoCallsTo(app, "todo.get").map(call => call.params)).toEqual([{ id: 3 }]);
  expect(app.calls.filter(call => ["todo.update", "todo.assign", "todo.move", "agent.spawn", "terminal.spawn", "agent.prompt"].includes(call.method))).toEqual([]);
});


it("u4698d_owner_escape_returns_to_the_meta_trigger_without_assignment", async () => {
  const { app } = await mountTodos([todo(1)]);
  { const row = await screen.findByRole("button", { name: "Idle #1 todo 1" }); row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }

  const panel = screen.getByRole("complementary", { name: "Drawer" });
  const owner = await within(panel).findByRole("button", { name: "Unassigned" });
  owner.focus();
  fireEvent.click(owner);
  const menu = await screen.findByRole("menu");
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(owner));
  expect(todoCallsTo(app, "todo.assign")).toEqual([]);
});
