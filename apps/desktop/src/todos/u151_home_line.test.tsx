import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountTodos, todo, todoRowOf as rowOf } from "./testHarness";

afterEach(cleanup);

describe("u151 the Home line of a row", () => {
  it("u151_a_row_holds_the_button_and_one_meta_line_with_the_id_the_waits_on_and_the_home_at_rest", async () => {
    await mountTodos([todo(1), todo(2), todo(3, { blocked: true, blockers: [1, 2], home: "r1" })], true, [workstream("r1", { name: "alpha" })]);
    await screen.findByText(/todo 3/);

    const row = rowOf(3);

    expect([...row.querySelector(".shelf-text")!.children].map((child) => child.tagName.toLowerCase())).toEqual(["div", "p"]);
    expect(row.querySelector("[data-todo-meta]")?.textContent?.replace(/\s+/g, " ").trim()).toBe("#3 waits on #1, #2 in alpha");
    expect(row.querySelector("[data-todo-waits]")?.textContent).toBe("waits on #1, #2");
    expect(row.querySelector("[data-todo-home]")?.textContent).toBe("in alpha");
    expect(rowOf(1).querySelector("[data-todo-home]")?.textContent).toBe("in project root");
    expect(rowOf(1).querySelector("[data-todo-waits]")).toBeNull();
  });

  it("u151_the_home_line_is_no_button_and_no_tab_stop", async () => {
    await mountTodos([todo(1)]);
    await screen.findByText(/todo 1/);

    const line = rowOf(1).querySelector("[data-todo-home]")!;

    expect([line.tagName, line.querySelectorAll("button, [tabindex]").length]).toEqual(["SPAN", 0]);
  });

  it("u151_complete_and_move_are_absent_from_the_row_at_rest", async () => {
    await mountTodos([todo(1)]);
    await screen.findByText(/todo 1/);

    expect(rowOf(1).textContent).not.toMatch(/complete|move/);
  });
});
