// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { AGENT, openShelf, padOf } from "../pads/padsFixture";
import { mountTodos, todo } from "./testHarness";
import { reorderChange } from "./state";

afterEach(cleanup);

const noReply = (method: string) => new RpcError(-32603, `no reply to ${method} within 5s`);

it("u5172a_unanswered_todo_toggle_shows_the_asked_state_marked_applying", async () => {
  const { app } = await mountTodos([todo(3)]);
  app.handlers["todo.complete"] = () => { throw noReply("todo.complete"); };

  const box = await screen.findByRole<HTMLInputElement>("checkbox", { name: "Complete todo 3" });

  fireEvent.click(box);
  await waitFor(() => expect(box.getAttribute("aria-busy")).toBe("true"));
  expect(box.checked).toBe(true);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("u5172a_unanswered_pad_rename_shows_the_asked_name_marked_applying", async () => {
  const { app } = await openShelf([padOf("notes", AGENT, "a")]);
  app.handlers["pad.rename"] = () => { throw noReply("pad.rename"); };

  const row = await screen.findByRole("button", { name: "notes" });
  row.focus();
  fireEvent.keyDown(row, { key: "F2", code: "F2" });
  const field = await screen.findByRole<HTMLInputElement>("textbox");
  fireEvent.input(field, { target: { value: "plan" } });
  fireEvent.keyDown(field, { key: "Enter" });

  const renamed = await screen.findByRole("button", { name: "plan" });
  expect(renamed.getAttribute("aria-busy")).toBe("true");
  expect(screen.queryByText(/Rename failed:/)).toBeNull();
});

const user = { kind: "user", id: "you", parent: null } as const;

it("u5172a_unanswered_todo_assign_shows_the_asked_owner_marked_until_a_read_settles_it", async () => {
  const { app, todos, store } = await mountTodos([todo(3), todo(4)]);
  const outcome = await todos.ask(3, { kind: "owner", asked: user, base: null }, () => Promise.reject(noReply("todo.assign")));

  expect(outcome).toBeNull();
  expect(todos.byId().get(3)?.owner).toEqual(user);
  await waitFor(() => expect(document.querySelector('[data-todo="3"]')?.getAttribute("aria-busy")).toBe("true"));
  await todos.reload();
  expect(todos.pendingOf(3)).not.toBeNull();
  store.todos = store.todos.map(each => each.id === 3 ? { ...each, owner: user } : each);
  await todos.reload();
  expect(todos.pendingOf(3)).toBeNull();
  expect(todos.byId().get(3)?.owner).toEqual(user);
});

it("u5172a_unanswered_todo_reorder_shows_the_asked_order_and_a_contradicting_read_shows_one_failure", async () => {
  const { todos, store } = await mountTodos([todo(3), todo(4), todo(5)]);
  const failures: string[] = [];
  todos.onContradicted((_, message) => failures.push(message));

  await todos.ask(5, reorderChange(todos.all(), 5, 3), () => Promise.reject(noReply("todo.reorder")));
  expect(todos.all().map(each => each.id)).toEqual([5, 3, 4]);
  await todos.reload();
  expect(todos.pendingOf(5)).not.toBeNull();
  expect(failures).toHaveLength(0);
  store.todos = [todo(3), todo(5), todo(4)];
  await todos.reload();
  expect(todos.pendingOf(5)).toBeNull();
  expect(todos.all().map(each => each.id)).toEqual([3, 5, 4]);
  expect(failures).toHaveLength(1);
});
