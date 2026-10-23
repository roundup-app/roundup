import { agent as agentNode } from "../testing/nodes";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
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

    const done = await screen.findByRole<HTMLInputElement>("checkbox", { name: "Reopen ship it" });

    expect(done.checked).toBe(true);
    expect(done.disabled).toBe(false);
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

  it("u361_waits_on_names_blockers_by_title", async () => {
    const { app } = await mountTodos([
      todo(5, { title: "session store", blocked: true, blockers: [6, 4] }),
      todo(4, { title: "migrate" }),
      todo(6, { title: "later" }),
    ]);

    await screen.findByText("session store");

    const waits = rowOf(5).querySelector<HTMLElement>("[data-todo-also-waits]")!;

    expect(within(waits).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["Open blocker migrate", "Open blocker later"]);

    fireEvent.click(within(waits).getByRole("button", { name: "Open blocker migrate" }));

    const drawer = await screen.findByRole("complementary", { name: "Drawer" });

    await waitFor(() => expect(within(drawer).getByText("migrate")).toBeTruthy());
    await waitFor(() => expect(callsTo(app, "todo.getHistory").map((call) => call.params)).toEqual([{ id: 4 }]));
  });
});

it.each(["list", "agent-list", "drawer"].flatMap(surface => [false].map(done => ({ surface, done }))))("u461a_completion_pending_and_failure_preserve_accepted_value on $surface", async ({ surface, done }) => {
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
