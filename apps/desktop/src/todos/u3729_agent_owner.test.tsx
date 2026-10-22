import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { agent, workstream } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo as callsTo, todoEvent } from "./testHarness";

afterEach(cleanup);

const by = (id: string) => ({ kind: "agent" as const, id, parent: null });

const RAIL = [workstream("w", { name: "work" }), agent("a", "idle", "A", { name: "alpha", parent: "w" }), agent("b", "idle", "B", { name: "beta", parent: "w", order: 1 })];

const file = async (button: string, title: string) => {
  fireEvent.click(screen.getByRole("button", { name: button }));
  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: "New Todo title" });

  fireEvent.input(field, { target: { value: title } });
  fireEvent.keyDown(field, { key: "Enter" });

  return field;
};

it("u3729_a_todo_made_under_an_agent_is_owned_by_it_and_listed_in_its_group", async () => {
  const { app, connected, store } = await mountTodos([], true, RAIL);

  connected.rail.select("a");
  await waitFor(() => expect(screen.getByRole("button", { name: "add todo to alpha" })).toBeTruthy());
  await file("add todo to alpha", "mine");
  await waitFor(() => expect(callsTo(app, "todo.move")).toHaveLength(1));
  app.emit(todoEvent("todo.updated", store.todos[0]!));

  expect(callsTo(app, "todo.create").map(call => call.params)).toEqual([{ title: "mine", body: null, blockers: null, owner: by("a") }]);
  expect(callsTo(app, "todo.move")[0]!.params).toEqual({ id: 1, home: "w" });
  await waitFor(() => expect(document.querySelector('[data-shelf-group="a"] [data-todo="1"]')).toBeTruthy());
});

it("u3729_a_workstream_or_root_selection_keeps_todays_owner", async () => {
  const { app, connected } = await mountTodos([], true, RAIL);

  connected.rail.select("w");
  await waitFor(() => expect(screen.getByRole("button", { name: "add todo to work" })).toBeTruthy());
  await file("add todo to work", "ws");
  await waitFor(() => expect(callsTo(app, "todo.move")).toHaveLength(1));
  connected.rail.select(null);
  await waitFor(() => expect(screen.getByRole("button", { name: "add todo to Overview" })).toBeTruthy());
  await file("add todo to Overview", "root");
  await waitFor(() => expect(callsTo(app, "todo.create")).toHaveLength(2));

  expect(callsTo(app, "todo.create").map(call => call.params)).toEqual([{ title: "ws", body: null, blockers: null }, { title: "root", body: null, blockers: null }]);
});

it("u3729_a_refused_create_keeps_the_title_and_shows_its_cause", async () => {
  const { app, connected } = await mountTodos([], true, RAIL);

  app.handlers["todo.create"] = () => { throw new RpcError(-32004, "agent gone"); };

  connected.rail.select("a");
  await waitFor(() => expect(screen.getByRole("button", { name: "add todo to alpha" })).toBeTruthy());
  const field = await file("add todo to alpha", "kept");

  expect(await screen.findByText(/agent gone/)).toBeTruthy();
  expect(field.value).toBe("kept");
});

it("u3730_an_agent_view_lists_todos_it_owns_and_made", async () => {
  const { connected } = await mountTodos([todo(1, { owner: by("a"), creator: by("b") }), todo(2, { creator: by("a"), owner: by("b") }), todo(3, { owner: by("b"), creator: by("b") })], true, RAIL);

  connected.rail.select("a");
  await waitFor(() => expect([...document.querySelectorAll("[data-todo]")].map(row => row.getAttribute("data-todo"))).toEqual(["1", "2"]));
  expect(document.querySelector('[data-shelf-group="a"] [data-todo="1"]')).toBeTruthy();
  expect(document.querySelector('[data-shelf-group="b"] [data-todo="2"]')).toBeTruthy();
});

it("u3730_a_reassigned_todo_leaves_the_view_unless_the_agent_made_it", async () => {
  const { connected, app, store } = await mountTodos([todo(1, { owner: by("a"), creator: by("b") }), todo(2, { owner: by("a"), creator: by("a") })], true, RAIL);

  connected.rail.select("a");
  await waitFor(() => expect(document.querySelectorAll("[data-todo]")).toHaveLength(2));
  store.todos = store.todos.map(each => ({ ...each, owner: by("b") }));

  for (const each of store.todos) app.emit(todoEvent("todo.updated", each));
  await waitFor(() => expect([...document.querySelectorAll("[data-todo]")].map(row => row.getAttribute("data-todo"))).toEqual(["2"]));
});
