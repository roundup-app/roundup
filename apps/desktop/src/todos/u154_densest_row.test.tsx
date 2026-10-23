import { cleanup, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountTodos, todo, todoRowOf as rowOf } from "./testHarness";

afterEach(cleanup);

const LONG_ROOM = "r".repeat(60);

const densest = () => [
  todo(1, { title: "t".repeat(120), home: "r1" }),
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((id) => todo(id)),
  todo(12, { blocked: true, blockers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }),
];

// U154: full names remain accessible; the rendered observer checks clipping and dense errors.
describe("u154 the row on the densest data", () => {
  it("u154_dense_titles_and_blockers_keep_their_accessible_names", async () => {
    await mountTodos(densest(), true, [workstream("r1", { name: LONG_ROOM })]);
    await screen.findByRole("button", { name: /#12 / });

    const row = rowOf(12);

    expect(rowOf(1).querySelector("[data-todo-home]")).toBeNull();
    expect(within(row).getAllByRole("button", { name: /^Open blocker/ }).map(button => button.getAttribute("aria-label"))).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(id => `Open blocker todo ${id}`));
    expect(screen.getByRole("button", { name: `Idle #1 ${"t".repeat(120)}` })).toBeTruthy();
  });


});
