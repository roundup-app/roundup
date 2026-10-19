import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo } from "../todos/testHarness";
import { USER } from "../testing/nodes";

afterEach(cleanup);

it("u458_selection_survives_refetch_by_identity", async () => {
  const { app, store } = await mountTodos([todo(1), todo(2)]);
  fireEvent.click(await screen.findByRole("button", { name: /#2 / }), { metaKey: true });
  store.todos = [todo(3), todo(2, { title: "changed" }), todo(1)];
  app.emit({ actor: USER, name: "todo.updated", data: store.todos[1]! });
  const changed = await screen.findByRole("button", { name: /#2 changed/ });
  expect(changed.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("1 selected")).toBeTruthy();
});

it("u458_hidden_rows_and_context_changes_clear_selection", async () => {
  const { connected } = await mountTodos([todo(1, { done: true }), todo(2)]);
  fireEvent.click(await screen.findByRole("button", { name: "1 done" }));
  fireEvent.click(screen.getByRole("button", { name: /#1 / }), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "1 done" }));
  expect(screen.queryByText("1 selected")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /#2 / }), { metaKey: true });
  connected.rail.select("scope-row");
  await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());
});

it("u458_tick_blocker_and_drag_keep_their_actions", async () => {
  const { app, connected } = await mountTodos([todo(1), todo(2, { blockers: [1], blocked: true })]);
  fireEvent.click(await screen.findByRole("button", { name: /#2 / }), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Open blocker todo 1" }), { metaKey: true });
  expect(connected.drawer.content()).not.toBeNull();
  expect(screen.getByText("1 selected")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Complete todo 2" }), { metaKey: true });
  expect(app.calls.filter((call) => call.method === "todo.complete").map((call) => call.params)).toEqual([{ id: 2 }]);
});
