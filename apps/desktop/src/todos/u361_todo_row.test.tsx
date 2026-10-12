import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import inkStyles from "../ink/styles.css?inline";
import { mountTodos, todo, todoCallsTo as callsTo, todoRowOf as rowOf } from "./testHarness";

afterEach(cleanup);

/** A checkbox found by name, narrowed without an assertion. */
const checkbox = async (name: string): Promise<HTMLInputElement> => {
  const box = await screen.findByRole("checkbox", { name });

  if (!(box instanceof HTMLInputElement)) throw new Error(`${name} is no input`);

  return box;
};

describe("u361 a Todo row holds a tick box, its title and what it waits on", () => {
  it("u361_a_tick_box_completes_a_todo", async () => {
    const { app } = await mountTodos([todo(3), todo(4, { done: true })]);
    const box = await checkbox("complete todo 3");

    expect(box.checked).toBe(false);
    fireEvent.click(box);

    await waitFor(() => expect(callsTo(app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 3 } }]));
    expect(callsTo(app, "todo.get")).toEqual([]);

    fireEvent.click(await screen.findByRole("button", { name: "1 done" }));
    const done = await checkbox("complete todo 4");

    expect([done.checked, done.disabled]).toEqual([true, true]);
  });

  it("u361_a_failed_complete_unchecks_the_box_and_shows_the_message", async () => {
    const { app } = await mountTodos([todo(3)]);
    app.handlers["todo.complete"] = () => Promise.reject(new Error("nope"));
    const box = await checkbox("complete todo 3");

    fireEvent.click(box);

    await waitFor(() => expect(within(rowOf(3)).getByRole("alert").textContent).toContain("nope"));
    expect(box.checked).toBe(false);
  });

  it("u361_nothing_draws_over_a_title_on_hover_or_focus", async () => {
    await mountTodos([todo(3)]);
    await screen.findByText("todo 3");

    for (const move of [() => fireEvent.mouseEnter(rowOf(3)), () => screen.getByRole("button", { name: "idle #3 todo 3" }).focus()]) {
      move();
      expect(screen.queryByText("complete")).toBeNull();
      expect(screen.queryByText("move")).toBeNull();
      expect(rowOf(3).querySelector('[data-button="row-action"]')).toBeNull();
    }
  });

  it("u361_a_row_shows_no_id_and_no_home", async () => {
    await mountTodos([todo(3, { title: "alpha", home: "w1" })]);
    await screen.findByText("alpha");

    expect(rowOf(3).textContent).toBe("alpha");
    expect(rowOf(3).querySelector("[data-todo-home]")).toBeNull();
  });

  it("u361_waits_on_names_blockers_by_title", async () => {
    await mountTodos([todo(5, { title: "store", blocked: true, blockers: [6, 4] }), todo(4, { title: "migrate" }), todo(6, { title: "later" })]);
    await screen.findByText("store");

    const waits = rowOf(5).querySelector<HTMLElement>("[data-todo-waits]");

    expect(waits?.textContent?.replace(/\s+/g, " ").trim()).toBe("waits on migrate, later");
    expect(waits?.getAttribute("title")).toBe("waits on migrate, later");

    fireEvent.click(within(rowOf(5)).getByRole("button", { name: "open blocker migrate" }));

    expect(await screen.findByRole("complementary", { name: "drawer" })).toBeTruthy();
    expect(await within(screen.getByRole("complementary", { name: "drawer" })).findByText("migrate")).toBeTruthy();
  });

  it("u361_the_wash_keeps_a_token_inset_from_the_text", async () => {
    const sheet = document.createElement("style");

    sheet.textContent = inkStyles;
    document.head.appendChild(sheet);
    await mountTodos([todo(3), todo(4, { done: true })]);
    fireEvent.click(await screen.findByRole("button", { name: "1 done" }));

    for (const row of [rowOf(3), screen.getByRole("button", { name: "done #4 todo 4" }).closest<HTMLElement>(".shelf-row")!]) {
      const style = getComputedStyle(row);

      expect([style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]).toEqual(["var(--space-1)", "var(--space-2)", "var(--space-1)", "var(--space-2)"]);
    }

    sheet.remove();
  });
});
