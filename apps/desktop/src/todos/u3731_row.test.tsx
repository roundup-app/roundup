import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

const bodyOf = (row: HTMLElement) => row.querySelector<HTMLElement>("[data-todo-description]");

const rowOf = async (name: RegExp) => (await screen.findByRole("button", { name })).closest<HTMLElement>("[data-todo]")!;

it("u3731_a_row_shows_the_first_body_line_only_when_there_is_a_body", async () => {
  await mountTodos([todo(1, { title: "alpha", body: "\n  first line  \nsecond line" }), todo(2, { title: "beta" })]);
  fireEvent.click(await screen.findByText("Unassigned"));
  const filled = await rowOf(/alpha/);

  expect(bodyOf(filled)!.textContent).toBe("first line");
  expect(bodyOf(await rowOf(/beta/))).toBeNull();
});

it("u3731_the_body_line_is_one_line_with_the_whole_text_as_its_title", async () => {
  const long = "x".repeat(300);
  await mountTodos([todo(1, { title: "alpha", body: `${long}\nnext` }), todo(2, { title: "gone", done: true, body: "done body" })]);
  fireEvent.click(await screen.findByText("Unassigned"));
  const line = bodyOf(await rowOf(/alpha/))!;

  expect(line.getAttribute("title")).toBe(long);
  expect(line.textContent).toBe(long);
  fireEvent.click(await screen.findByRole("button", { name: "1 done" }));
  expect(bodyOf(await rowOf(/gone/))!.textContent).toBe("done body");
  expect(within(await rowOf(/alpha/)).getAllByRole("button").length).toBeGreaterThan(0);
});
