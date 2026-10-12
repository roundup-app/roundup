import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import rowStyles from "./rowButton.styles.css?inline";
import { mountTodos, todo, todoCallsTo as callsTo, todoEvent, todoRowOf as rowOf } from "./testHarness";

afterEach(cleanup);

const boxOf = (row: HTMLElement) => within(row).getByRole<HTMLInputElement>("checkbox");

describe("u361 a Todo row holds a tick box, its title and what it waits on", () => {
  it("u361_a_tick_box_completes_a_todo", async () => {
    const { app, store } = await mountTodos([todo(3, { title: "ship it" }), todo(4, { title: "later", blocked: true, blockers: [3] })]);
    const box = await screen.findByRole<HTMLInputElement>("checkbox", { name: "complete ship it" });

    expect(box.checked).toBe(false);
    expect(within(rowOf(4)).getByRole("img", { name: "blocked" })).toBeTruthy();
    expect(boxOf(rowOf(4)).getAttribute("aria-label")).toBe("complete later");

    fireEvent.click(box);

    await waitFor(() => expect(callsTo(app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 3 } }]));
    expect(callsTo(app, "todo.get")).toEqual([]);
    expect(document.querySelector(".drawer")?.getAttribute("data-open")).toBe("false");

    store.todos = store.todos.map((candidate) => (candidate.id === 3 ? { ...candidate, done: true } : candidate));
    app.emit(todoEvent("todo.updated", store.todos[0]!));

    fireEvent.click(await screen.findByRole("button", { name: /1 done/ }));

    const done = screen.getByRole<HTMLInputElement>("checkbox", { name: "complete ship it" });

    expect(done.checked).toBe(true);
    expect(done.disabled).toBe(true);
  });

  it("u361_repeated_toggles_while_pending_complete_only_once", async () => {
    const { app } = await mountTodos([todo(3)]);
    app.handlers["todo.complete"] = () => new Promise(() => {});
    const box = await screen.findByRole("checkbox", { name: "complete todo 3" });
    fireEvent.click(box);
    fireEvent.click(box);
    fireEvent.click(box);
    await waitFor(() => expect(callsTo(app, "todo.complete")).toHaveLength(1));
  });

  it("u361_a_successful_tick_box_waits_for_todo_updated_before_another_completion", async () => {
    const { app } = await mountTodos([todo(3)]);
    const box = await screen.findByRole<HTMLInputElement>("checkbox", { name: "complete todo 3" });

    fireEvent.click(box);
    await waitFor(() => expect(callsTo(app, "todo.complete")).toHaveLength(1));
    fireEvent.click(box);
    fireEvent.click(box);

    expect(callsTo(app, "todo.complete")).toHaveLength(1);
    expect(box.checked).toBe(true);
    expect(within(rowOf(3)).getByRole("button", { name: /todo 3/ })).toBeTruthy();
  });

  it("u361_nothing_draws_over_a_title_on_hover_or_focus", async () => {
    await mountTodos([todo(3, { title: "ship it" })]);
    await screen.findByText("ship it");

    const row = rowOf(3);

    for (const act of [() => {}, () => fireEvent.mouseEnter(row), () => fireEvent.focusIn(screen.getByRole("button", { name: /#3/ }))]) {
      act();

      expect(within(row).queryByText("complete")).toBeNull();
      expect(within(row).queryByText("move")).toBeNull();
      expect(row.querySelector(".complete, .todo-move")).toBeNull();
    }

    expect(rowStyles).not.toMatch(/position:\s*absolute;\s*top: var\(--space-1\)/);
  });

  it("u361_a_row_shows_no_id_and_no_home", async () => {
    await mountTodos([todo(7, { title: "Feedback 2:" }), todo(8, { title: "blocked one", blocked: true, blockers: [7] })]);
    await screen.findByRole("checkbox", { name: "complete Feedback 2:" });

    for (const id of [7, 8]) {
      const row = rowOf(id);

      expect(row.textContent).not.toContain(`#${id}`);
      expect(row.querySelector("[data-todo-home]")).toBeNull();
      expect(row.textContent).not.toMatch(/\bin (project root|\w+)$/);
    }

    expect(rowOf(7).textContent?.trim()).toBe("Feedback 2:");
  });

  it("u361_waits_on_names_blockers_by_title", async () => {
    const { app } = await mountTodos([
      todo(5, { title: "session store", blocked: true, blockers: [6, 4] }),
      todo(4, { title: "migrate" }),
      todo(6, { title: "later" }),
    ]);

    await screen.findByText("session store");

    const waits = rowOf(5).querySelector<HTMLElement>("[data-todo-waits]")!;

    expect(waits.textContent?.replace(/\s+/g, " ").trim()).toBe("waits on migrate, later");
    expect(waits.getAttribute("title")).toBe("waits on migrate, later");

    fireEvent.click(within(waits).getByRole("button", { name: "open blocker later" }));

    const drawer = await screen.findByRole("complementary", { name: "drawer" });

    await waitFor(() => expect(within(drawer).getByText("later")).toBeTruthy());
    expect(callsTo(app, "todo.get").map((call) => call.params)).toEqual([{ id: 6 }]);
  });

  it("u361_the_wash_keeps_a_token_inset_from_the_text", async () => {
    await mountTodos([todo(3)]);
    await screen.findByText("todo 3");

    expect(rowOf(3).classList.contains("todo-inset")).toBe(true);
    expect(rowStyles).toMatch(/\.shelf-row\.todo-inset\s*{\s*padding-inline: var\(--space-2\);/);
  });
});
