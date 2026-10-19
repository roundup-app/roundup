import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos } from "./testHarness";

afterEach(cleanup);

it("u2773a_todos_restores_exact_work_after_hiding_creation", async () => {
  const { app } = await mountTodos([]);
  fireEvent.click(await screen.findByRole("button", { name: "Add Todo" }));
  const text = "  e\u0301 🧪 unfinished  ";
  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  fireEvent.input(field, { target: { value: text } });
  field.setSelectionRange(2, 5, "backward");
  fireEvent.select(field);
  fireEvent.keyDown(field, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Add Todo" }));
  const restored = screen.getByRole<HTMLInputElement>("textbox", { name: "New Todo title" });
  expect([restored.value, restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([text, 2, 5, "backward"]);
  expect(app.calls.filter(call => call.method === "todo.create")).toEqual([]);
});
