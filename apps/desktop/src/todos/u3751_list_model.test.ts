import { createRoot } from "solid-js";
import { expect, it } from "vitest";
import type { Todo } from "@contracts/todo/Todo";
import { todo } from "./testHarness";
import { createListModel, survivorOf } from "./listModel";

const row = (id: number, over: Partial<Todo> = {}) => ({ todo: todo(id, over) });

it("u3751_open_order_lists_open_visible_todos_in_render_order", () => {
  createRoot(dispose => {
    const { openOrder } = createListModel({
      rows: () => [row(3), row(1, { done: true }), row(2), row(5), row(4)],
      visible: id => id !== 2,
      closedGroups: () => ["g"],
      groupOf: todo => (todo.id === 5 ? "g" : "open"),
    });

    expect(openOrder()).toEqual([3, 4]);
    dispose();
  });
});

it("u3474b_survivor_is_the_next_open_row_else_the_previous_else_none", () => {
  expect(survivorOf([1, 2, 3], 2)).toBe(3);
  expect(survivorOf([1, 2, 3], 3)).toBe(2);
  expect(survivorOf([1], 1)).toBeUndefined();
});
