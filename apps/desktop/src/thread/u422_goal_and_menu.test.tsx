import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agent, door } from "../testing/nodes";
import { message, mountThread } from "./threadFixture";

const ORDER = `${"First sentence of the order. "}${"Second sentence says more. "}${"Third sentence ends it ".repeat(6)}`;

const tree = () => [door("r1", "working", "working", { name: "lead", work: { kind: "work", ask: ORDER, limits: ["a", "b", "c", "d", "e"] } }), agent("a", "working", "x", { parent: "r1", name: "ann" })];

const DOOR = { kind: "agent", id: "r1", parent: null } as const;

const goal = () => document.querySelector<HTMLElement>("[data-goal]")!;

const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  await vi.waitFor(() => expect(screen.queryAllByRole("menuitem").length).toBeGreaterThan(0));
};

afterEach(cleanup);

describe("u422 the Workstream view opens on its goal, with one menu", () => {
  it("u422_the_goal_is_the_first_sentence_on_one_line", async () => {
    await mountThread(tree(), { fold: "closed" });

    expect(goal().textContent).toBe("First sentence of the order.");
    expect(screen.getByRole("button", { name: "order of lead" }).getAttribute("title")).toBe(ORDER);
    expect(getComputedStyle(goal()).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(goal()).textOverflow).toBe("ellipsis");
    expect(document.querySelector("[data-thread-header]")!.textContent).not.toMatch(/limit/);
  });

  it("u422_the_goal_opens_the_whole_order", async () => {
    const { connected } = await mountThread(tree(), { fold: "closed" });

    fireEvent.click(screen.getByRole("button", { name: "order of lead" }));

    expect(connected.drawer.content()).not.toBeNull();
  });

  it("u422_the_menu_holds_an_icon_and_a_label_per_item", async () => {
    await mountThread(tree(), { fold: "closed" });
    await open();

    const items = screen.getAllByRole("menuitem");

    expect(items.map((item) => item.textContent)).toEqual(["Whole order", "Take over", "Clear…", "All messages"]);

    for (const item of items) expect(item.querySelector("svg")).not.toBeNull();
  });

  it("u422_the_menu_closes_on_escape_and_outside", async () => {
    await mountThread(tree(), { fold: "closed" });
    await open();

    fireEvent.keyDown(screen.getAllByRole("menuitem")[0]!, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryAllByRole("menuitem")).toHaveLength(0));

    await open();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    await vi.waitFor(() => expect(screen.queryAllByRole("menuitem")).toHaveLength(0));
  });

  it("u422_all_messages_shows_the_runs_only_when_chosen", async () => {
    await mountThread(tree(), { fold: "closed", messages: [message(1, { from: DOOR, to: "you", body: "hello there" })] });

    expect(document.querySelector("[data-log]")).toBeNull();
    expect(document.body.textContent).not.toContain("hello there");

    await open();
    fireEvent.click(screen.getByRole("menuitem", { name: "All messages" }));

    await vi.waitFor(() => expect(document.querySelector("[data-log]")?.textContent).toContain("hello there"));
  });

  it("u422_the_view_holds_none_of_the_old_words", async () => {
    await mountThread(tree(), { fold: "closed", messages: [message(1, { from: DOOR, to: "you", body: "hello there" })] });

    const text = document.querySelector(".thread")!.textContent!;

    for (const word of ["limits", "no checkpoint yet", "full log", "working", "delivered"]) expect(text).not.toContain(word);

    expect(text).not.toMatch(/\d\d:\d\d/);
  });
});
