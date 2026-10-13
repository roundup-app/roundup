import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo } from "../todos/testHarness";

afterEach(cleanup);

it("u458_pointer_toggle_and_range_follow_visible_order", async () => {
  const { app, connected } = await mountTodos([todo(1), todo(2), todo(3), todo(4), todo(5)]);
  const first = await screen.findByRole("button", { name: /#1 / });
  fireEvent.click(first, { metaKey: true });
  expect(first.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: /#4 / }), { shiftKey: true });
  expect(screen.getByText("4 selected")).toBeTruthy();
  expect(connected.drawer.content()).toBeNull();
  expect(todoCallsTo(app, "todo.delete")).toEqual([]);
});
