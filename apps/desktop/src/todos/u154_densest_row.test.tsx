import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import rowCss from "./rowButton.styles.css?inline";
import appCss from "../styles.css?inline";
import inkCss from "../ink/styles.css?inline";
import { mountTodos, todo, todoRowOf as rowOf } from "./testHarness";

const sheet = document.createElement("style");

sheet.textContent = `${rowCss}\n${appCss}`;

beforeEach(() => document.head.appendChild(sheet));

afterEach(() => {
  cleanup();
  sheet.remove();
});

const LONG_ROOM = "r".repeat(60);

const densest = () => [
  todo(1, { title: "t".repeat(120), home: "r1" }),
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((id) => todo(id)),
  todo(12, { blocked: true, blockers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }),
];

// U359 changes "no text is cut with an ellipsis": a title ends after two lines with `…` and the meta line after one; the whole text is the title attribute and the Drawer. jsdom has no layout, so the rules are read from the stylesheet and the full text from the DOM.
describe("u154 the row on the densest data", () => {
  it("u154_the_title_clamps_at_two_lines_the_meta_line_at_one_and_the_whole_text_is_kept", async () => {
    await mountTodos(densest(), true, [workstream("r1", { name: LONG_ROOM })]);
    await screen.findByRole("button", { name: /#12 / });

    const row = rowOf(12);

    expect(rowOf(1).querySelector("[data-todo-home]")).toBeNull();
    expect(row.querySelector("[data-todo-waits]")?.textContent?.replace(/\s+/g, " ").trim()).toBe("waits on todo 2, todo 3, todo 4, todo 5, todo 6, todo 7, todo 8, todo 9, todo 10, todo 11");
    expect(rowOf(1).querySelector(".shelf-title")?.getAttribute("title")).toBe("t".repeat(120));
    expect(inkCss).toMatch(/\.shelf-title\s*\{[^}]*-webkit-line-clamp:\s*2;[^}]*overflow:\s*hidden/);
    expect(inkCss).toMatch(/\.shelf-meta\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap/);
  });

  it("u154_a_failure_takes_the_place_of_the_waits_on_line_and_no_home_line_appears", async () => {
    const { app } = await mountTodos(densest(), true, [workstream("r1", { name: LONG_ROOM })]);

    await screen.findByRole("button", { name: /#12 / });
    app.handlers["todo.complete"] = () => Promise.reject(new Error("could not complete the todo"));

    fireEvent.click(await screen.findByRole("checkbox", { name: "complete todo 12" }));
    await screen.findByText("could not complete the todo");

    expect(rowOf(12).querySelector("[data-todo-waits]")).toBeNull();
    expect(rowOf(12).querySelector("[data-todo-home]")).toBeNull();
  });
});
