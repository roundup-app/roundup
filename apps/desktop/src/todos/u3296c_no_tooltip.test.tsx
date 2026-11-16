import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { mountTodos, todo, todoRowOf as rowOf } from "./testHarness";

afterEach(cleanup);

it("u3296c_selecting_a_todo_opens_no_tooltip", async () => {
  await mountTodos([todo(3, { title: "first" }), todo(4, { title: "second" })]);
  await screen.findByRole("checkbox", { name: "Complete first" });
  const first = rowOf(3).querySelector<HTMLButtonElement>(".todo-row-button")!;
  const second = rowOf(4).querySelector<HTMLButtonElement>(".todo-row-button")!;

  vi.spyOn(first, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 20));
  fireEvent.pointerEnter(first, { pointerType: "mouse", clientX: 10, clientY: 10 });
  fireEvent.click(first);
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  second.focus();
  fireEvent.keyDown(second, { key: "Tab" });
  await new Promise((done) => setTimeout(done, 600));

  // An icon-only button (the Drawer's Close) keeps its label Tooltip; no text Tooltip opens.
  expect(screen.queryAllByRole("tooltip").map((tip) => tip.textContent).filter((text) => text === "first" || text === "second")).toEqual([]);
});
