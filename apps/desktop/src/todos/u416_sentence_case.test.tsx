import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

it("u416_todo_add_and_empty_hint_keep_the_glossary_capital", async () => {
  await mountTodos([]);
  expect(await screen.findByText("No Todos yet")).toBeTruthy();
  const add = screen.getByRole("button", { name: "Add Todo" });
  expect(add.textContent).toBe("Todo");
  fireEvent.click(add);
  expect(screen.getByRole("textbox", { name: "New Todo title" })).toBeTruthy();
});
