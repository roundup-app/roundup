import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agent, door } from "../testing/nodes";
import { message, mountThread, text } from "./threadFixture";

const RUPD = { kind: "ext", id: "rupd", parent: null } as const;

const entry = (name: string, last: string, pads: string[] = []) => ({ name, kind: "idle", last, todos: 0, pads });

const digest = (id: number, ...entries: ReturnType<typeof entry>[]) => message(id, { from: RUPD, to: "r1", body: `[digest] ${entries.map(text).join("\n")}` });

const tree = () => [
  door("r1", "working", "editing", { name: "lead" }),
  agent("a", "working", "x", { parent: "r1", name: "a-quite-long-agent-name-that-must-not-wrap-onto-a-second-line" }),
  agent("b", "blocked", "x", { parent: "r1", name: "bea" }),
  agent("c", "error", "x", { parent: "r1", name: "cy" }),
  agent("d", "idle", "x", { parent: "r1", name: "dan" }),
  agent("e", "done", "x", { parent: "r1", name: "eve" }),
];

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-now]")];

const doneHead = () => document.querySelector<HTMLButtonElement>(".thread-done-head")!;

afterEach(cleanup);

describe("u424 Agent rows and the done count say who works and who finished", () => {
  it("u424_a_row_is_a_glyph_and_a_name_on_one_line", async () => {
    await mountThread(tree(), { fold: "closed" });
    await vi.waitFor(() => expect(rows()).toHaveLength(4));

    expect(rows().map((row) => row.querySelector(".thread-row-name")!.textContent)).toEqual(["lead", "a-quite-long-agent-name-that-must-not-wrap-onto-a-second-line", "bea", "cy"]);

    for (const row of rows()) {
      expect(row.querySelector("svg, [data-glyph]")).not.toBeNull();
      expect(getComputedStyle(row.querySelector(".thread-row-name")!).whiteSpace).toBe("nowrap");
      expect(getComputedStyle(row.querySelector(".thread-row-name")!).textOverflow).toBe("ellipsis");
    }
  });

  it("u424_done_counts_rail_and_digest_agents_once", async () => {
    await mountThread(tree(), { fold: "closed", messages: [digest(1, entry("dan", "old")), digest(2, entry("gone", "left the Rail")), digest(3, entry("lead", "the door itself")), digest(4, entry("bea", "still busy")), digest(5, entry("gone", "again"))] });
    await vi.waitFor(() => expect(doneHead()).not.toBeNull());

    expect(doneHead().textContent).toBe("3 done");
  });

  it("u424_done_is_absent_with_none", async () => {
    await mountThread([door("r1", "working", "editing", { name: "lead" })], { fold: "closed" });
    await vi.waitFor(() => expect(rows()).toHaveLength(1));

    expect(document.querySelector("[data-done]")).toBeNull();
  });

  it("u424_done_opens_to_name_last_line_and_pads", async () => {
    await mountThread(tree(), { fold: "closed", messages: [digest(1, entry("gone", "older")), digest(2, entry("gone", "Filed #1073", ["notes", "plan"]))] });
    await vi.waitFor(() => expect(doneHead()).not.toBeNull());

    expect(doneHead().getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-done-item]")).toBeNull();

    fireEvent.click(doneHead());

    const item = document.querySelector<HTMLElement>("[data-done-item='gone']")!;

    expect(item.querySelector(".thread-done-last")!.textContent).toBe("Filed #1073");
    expect(item.querySelector(".thread-done-pads")!.textContent).toBe("notes, plan");

    fireEvent.click(doneHead());
    expect(document.querySelector("[data-done-item]")).toBeNull();
  });

  it("u424_opening_done_moves_no_row_above", async () => {
    await mountThread(tree(), { fold: "closed" });
    await vi.waitFor(() => expect(doneHead()).not.toBeNull());

    const feed = document.querySelector(".thread-feed")!;
    const done = document.querySelector("[data-done]")!;
    const above = () => [...feed.children].slice(0, [...feed.children].indexOf(done)).map((el) => el.outerHTML);
    const before = above();

    fireEvent.mouseOver(rows()[0]!);
    fireEvent.click(doneHead());

    expect(above()).toEqual(before);
    expect(screen.getAllByRole("button", { name: "More" })).toHaveLength(1);
  });
});
