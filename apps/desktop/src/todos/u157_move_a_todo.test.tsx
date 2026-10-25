import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo } from "./testHarness";

afterEach(cleanup);

// U461 replaces U157's Drawer Home and Move paths; U362 owns moving by dragging the row.
it.each([null, "r1"])("u157_the_drawer_has_no_move_or_home_%s", async (home) => {
  const { app } = await mountTodos([todo(2, { home })], true, [workstream("r1", { name: "alpha" })]);

  fireEvent.keyDown(await screen.findByRole("button", { name: /#2/ }), { key: "Enter" });
  const panel = within(screen.getByRole("complementary", { name: "Drawer" }));
  await panel.findByText("Blocker");

  expect(panel.queryByRole("button", { name: "Move #2" })).toBeNull();
  expect(panel.queryByText(/^In /)).toBeNull();
  expect(todoCallsTo(app, "todo.move")).toHaveLength(0);
});

it("u157_a_done_todo_drawer_has_no_move", async () => {
  await mountTodos([todo(2, { done: true })]);

  fireEvent.click(await screen.findByRole("button", { name: "1 done" }));
  fireEvent.keyDown(await screen.findByRole("button", { name: /Done #2/ }), { key: "Enter" });
  const panel = within(screen.getByRole("complementary", { name: "Drawer" }));
  await panel.findByText("Blocker");

  expect(panel.queryByRole("button", { name: "Move #2" })).toBeNull();
});
