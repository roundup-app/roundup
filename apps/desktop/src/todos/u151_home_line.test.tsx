import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountTodos, todo, todoRowOf as rowOf } from "./testHarness";

afterEach(cleanup);

describe("u151 the Home line of a row", () => {
  it("u151_a_row_holds_the_button_and_one_meta_line_with_the_other_blockers_at_rest", async () => {
    await mountTodos([todo(1), todo(2), todo(3, { blocked: true, blockers: [1, 2], home: "r1" })], true, [workstream("r1", { name: "alpha" })]);
    await screen.findByText(/todo 3/);

    const row = rowOf(3);

    expect([...row.querySelector(".shelf-text")!.children].map((child) => child.tagName.toLowerCase())).toEqual(["p"]);
    expect(row.querySelector("[data-todo-meta]")?.textContent?.replace(/\s+/g, " ").trim()).toBe("also waits on: todo 1, todo 2");
    expect(row.querySelector("[data-todo-also-waits]")?.textContent).toBe("also waits on: todo 1, todo 2");
    expect(row.querySelector("[data-todo-home]")).toBeNull();
    expect(rowOf(1).querySelector("[data-todo-home]")).toBeNull();
    expect(rowOf(1).querySelector("[data-todo-also-waits]")).toBeNull();
  });

  it("u151_the_removed_home_line_adds_no_tab_stop", async () => {
    await mountTodos([todo(1)]);
    await screen.findByText(/todo 1/);

    expect(rowOf(1).querySelector("[data-todo-home]")).toBeNull();
  });

  it("u151_complete_and_move_are_absent_from_the_row_at_rest", async () => {
    await mountTodos([todo(1)]);
    await screen.findByText(/todo 1/);

    expect(rowOf(1).textContent).not.toMatch(/Complete|Move/);
  });
});
