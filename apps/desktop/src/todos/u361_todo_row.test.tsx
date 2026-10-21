import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent as agentNode } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo as callsTo, todoEvent, todoRowOf as rowOf } from "./testHarness";

afterEach(cleanup);

const boxOf = (row: HTMLElement) => within(row).getByRole<HTMLInputElement>("checkbox");

describe("u361 a Todo row holds a tick box, its title and what it waits on", () => {
  it("u361_a_tick_box_completes_a_todo", async () => {
    const { app, store } = await mountTodos([todo(3, { title: "ship it" }), todo(4, { title: "later", blocked: true, blockers: [3] })]);
    const box = await screen.findByRole<HTMLInputElement>("checkbox", { name: "Complete ship it" });

    expect(box.checked).toBe(false);
    expect(rowOf(4).getAttribute("aria-level")).toBe("2");
    expect(boxOf(rowOf(4)).getAttribute("aria-label")).toBe("Complete later");

    fireEvent.click(box);

    await waitFor(() => expect(callsTo(app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 3 } }]));
    expect(callsTo(app, "todo.get")).toEqual([]);
    expect(document.querySelector(".drawer")?.getAttribute("data-open")).toBe("false");

    store.todos = store.todos.map((candidate) => (candidate.id === 3 ? { ...candidate, done: true } : candidate));
    app.emit(todoEvent("todo.updated", store.todos[0]!));

    fireEvent.click(await screen.findByRole("button", { name: /1 done/ }));

    const done = screen.getByRole<HTMLInputElement>("checkbox", { name: "Reopen ship it" });

    expect(done.checked).toBe(true);
    expect(done.disabled).toBe(false);
  });

  it("u361_repeated_toggles_while_pending_complete_only_once", async () => {
    const { app } = await mountTodos([todo(3)]);
    app.handlers["todo.complete"] = () => new Promise(() => {});
    const box = await screen.findByRole("checkbox", { name: "Complete todo 3" });
    fireEvent.click(box);
    fireEvent.click(box);
    fireEvent.click(box);
    await waitFor(() => expect(callsTo(app, "todo.complete")).toHaveLength(1));
  });

  it("u361_a_successful_tick_box_waits_for_todo_updated_before_another_completion", async () => {
    const { app } = await mountTodos([todo(3)]);
    const box = await screen.findByRole<HTMLInputElement>("checkbox", { name: "Complete todo 3" });

    fireEvent.click(box);
    await waitFor(() => expect(callsTo(app, "todo.complete")).toHaveLength(1));
    fireEvent.click(box);
    fireEvent.click(box);

    expect(callsTo(app, "todo.complete")).toHaveLength(1);
    expect(box.checked).toBe(false);
    expect(within(rowOf(3)).getByRole("button", { name: /todo 3/ })).toBeTruthy();
  });

  it("u361_nothing_draws_over_a_title_on_hover_or_focus", async () => {
    await mountTodos([todo(3, { title: "ship it" })]);
    await screen.findByText("ship it");

    const row = rowOf(3);

    for (const act of [() => {}, () => fireEvent.mouseEnter(row), () => fireEvent.focusIn(screen.getByRole("button", { name: /^Idle #3 / }))]) {
      act();

      expect(within(row).queryByText("complete")).toBeNull();
      expect(within(row).queryByText("move")).toBeNull();
      expect(row.querySelector(".complete, .todo-move")).toBeNull();
    }

  });

  it("u361_a_row_shows_no_id_and_no_home", async () => {
    await mountTodos([todo(7, { title: "Feedback 2:" }), todo(8, { title: "blocked one", blocked: true, blockers: [7] })]);
    await screen.findByRole("checkbox", { name: "Complete Feedback 2:" });

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

    const waits = rowOf(5).querySelector<HTMLElement>("[data-todo-also-waits]")!;

    expect(waits.textContent?.replace(/\s+/g, " ").trim()).toBe("also waits on: migrate");

    fireEvent.click(within(waits).getByRole("button", { name: "Open blocker migrate" }));

    const drawer = await screen.findByRole("complementary", { name: "Drawer" });

    await waitFor(() => expect(within(drawer).getByText("migrate")).toBeTruthy());
    await waitFor(() => expect(callsTo(app, "todo.getHistory").map((call) => call.params)).toEqual([{ id: 4 }]));
  });
});

it.each(["list", "agent-list", "drawer"].flatMap(surface => [true, false].map(done => ({ surface, done }))))("u461a_pending_and_failure_preserve_accepted_value on $surface done=$done", async ({ surface, done }) => {
  const maker = { kind: "agent", id: "agent-1", parent: null } as const;
  const { app, connected } = await mountTodos([todo(1, { title: "ship", done, creator: maker })], true, [agentNode("agent-1", "idle", "ready")]);

  if (surface === "agent-list") connected.rail.select("agent-1");

  if (done) fireEvent.click(await screen.findByRole("button", { name: "1 done" }));

  if (surface === "drawer") fireEvent.click(await screen.findByRole("button", { name: `${done ? "Done" : "Idle"} #1 ship` }));

  const area = surface === "drawer" ? within(document.querySelector<HTMLElement>(".drawer")!) : screen;
  const box = await area.findByRole<HTMLInputElement>("checkbox", { name: `${done ? "Reopen" : "Complete"} ship` });
  const method = done ? "todo.reopen" : "todo.complete";
  let reject!: (reason: Error) => void;
  app.handlers[method] = () => new Promise((_, fail) => { reject = fail; });
  box.focus();
  fireEvent.click(box);
  fireEvent.click(box);
  expect(callsTo(app, method)).toEqual([{ method, params: { id: 1 } }]);
  expect(box.checked).toBe(done);
  reject(new Error("Cannot reopen"));
  await area.findByText("Cannot reopen");
  expect(box.checked).toBe(done);
  expect(document.activeElement).toBe(box);
  app.handlers[method] = () => new Promise(() => {});
  fireEvent.click(box);
  expect(callsTo(app, method)).toHaveLength(2);
  expect(callsTo(app, done ? "todo.complete" : "todo.reopen")).toHaveLength(0);
});

it.each([
  { ids: [1, 2, 3], reopen: 2, next: 3 },
  { ids: [1, 2], reopen: 2, next: 1 },
  { ids: [1], reopen: 1, next: null },
])("u461a_success_refetches_surfaces_and_keeps_focus from $ids", async ({ ids, reopen, next }) => {
  const { app, store } = await mountTodos(ids.map(id => todo(id, { done: true })));
  fireEvent.click(await screen.findByRole("button", { name: `${ids.length} done` }));
  const box = await screen.findByRole<HTMLInputElement>("checkbox", { name: `Reopen todo ${reopen}` });
  box.focus(); fireEvent.click(box);
  await waitFor(() => expect(callsTo(app, "todo.reopen")).toHaveLength(1));
  expect(box.checked).toBe(true);
  app.emit(todoEvent("todo.updated", store.todos.find(item => item.id === reopen)!));
  await screen.findByRole("checkbox", { name: `Complete todo ${reopen}` });
  await waitFor(() => expect(document.activeElement).toBe(next === null
    ? screen.getByRole("button", { name: "Add Todo" })
    : screen.getByRole("button", { name: new RegExp(`^Done #${next} `) })));
  expect(callsTo(app, "todo.complete")).toHaveLength(0);
  expect(callsTo(app, "todo.delete")).toHaveLength(0);
  expect(callsTo(app, "todo.move")).toHaveLength(0);
  expect(callsTo(app, "todo.getHistory")).toHaveLength(0);
});

it("u461a_success_refetches_surfaces_and_keeps_focus in the Drawer", async () => {
  const { app, store, connected } = await mountTodos([todo(1, { done: true }), todo(2, { blockers: [1] })]);
  fireEvent.click(await screen.findByRole("button", { name: "1 done" }));
  fireEvent.click(await screen.findByRole("button", { name: "Done #1 todo 1" }));
  const drawer = document.querySelector<HTMLElement>(".drawer")!;
  const box = await within(drawer).findByRole<HTMLInputElement>("checkbox", { name: "Reopen todo 1" });
  box.focus(); fireEvent.click(box);
  await waitFor(() => expect(callsTo(app, "todo.reopen")).toHaveLength(1));
  app.emit(todoEvent("todo.updated", store.todos[0]!));
  await waitFor(() => expect(box.checked).toBe(false));
  expect(document.activeElement).toBe(box);
  expect(connected.drawer.content()).not.toBeNull();
  expect(within(rowOf(1)).getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  expect(await screen.findByRole("button", { name: "Blocked #2 todo 2" })).toBeTruthy();
  expect(callsTo(app, "todo.reopen")).toEqual([{ method: "todo.reopen", params: { id: 1 } }]);
});
