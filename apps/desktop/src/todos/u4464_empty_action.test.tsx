import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { copy } from "../copy";
import { afterEach, expect, it } from "vitest";
import { mountTodos } from "./testHarness";

afterEach(cleanup);

it("u4464_empty_actions_do_what_the_existing_buttons_do_todo", async () => {
  await mountTodos([]);
  const empty = await screen.findByRole("group", { name: "No Todos yet" });
  expect(within(empty).getByText(copy.emptyTodosLine)).toBeTruthy();
  fireEvent.click(within(empty).getByRole("button", { name: "+ Todo" }));
  const field = await screen.findByRole("textbox", { name: /Todo/ });
  expect(document.activeElement).toBe(field);
});
