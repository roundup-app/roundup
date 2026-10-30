import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo } from "../todos/testHarness";
import { USER } from "../testing/nodes";

afterEach(cleanup);

it("u458_selection_survives_refetch_by_identity", async () => {
  const { app, store } = await mountTodos([todo(1), todo(2)]);
  fireEvent.click(await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #2 / }), { metaKey: true });
  store.todos = [todo(3), todo(2, { title: "changed" }), todo(1)];
  app.emit({ actor: USER, name: "todo.updated", data: store.todos[1]! });
  const changed = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #2 changed/ });
  expect(changed.getAttribute("aria-pressed")).toBe("true");
});

it("u458_hidden_rows_and_context_changes_clear_selection", async () => {
  const { connected } = await mountTodos([todo(1, { done: true }), todo(2)]);
  fireEvent.click(await screen.findByRole("button", { name: "1 done" }));
  fireEvent.click(screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "1 done" }));
  expect(screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #1 /, hidden: true }).getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #2 / }), { metaKey: true });
  connected.rail.select("scope-row");
  await waitFor(() => expect(screen.queryByRole("button", { name: /^(?:Idle|Blocked|Done) #2 /, pressed: true })).toBeNull());
});

it("u458_tick_blocker_and_drag_keep_their_actions", async () => {
  const { app, connected } = await mountTodos([todo(1), todo(2), todo(3, { blockers: [1, 2], blocked: true })]);
  fireEvent.click(await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #3 / }), { metaKey: true });
  { const focusedRow = screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #2 / }); focusedRow.focus(); fireEvent.keyDown(focusedRow, { key: "Enter", code: "Enter" }); }

  expect(connected.drawer.content()).not.toBeNull();
  expect(screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #3 / }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("checkbox", { name: "Complete todo 3" }), { metaKey: true });
  expect(app.calls.filter((call) => call.method === "todo.complete").map((call) => call.params)).toEqual([{ id: 3 }]);
});
