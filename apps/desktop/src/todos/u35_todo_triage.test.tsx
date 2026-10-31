import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { USER } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo as callsTo, todoEvent, todoRowOf as rowOf } from "./testHarness";

afterEach(cleanup);

const blocked = () => todo(5, { title: "session store", blocked: true, blockers: [6, 4] });

const shelf = () => [blocked(), todo(4, { title: "migrate" }), todo(6, { title: "later" })];

describe("u35 Todo triage without the Drawer", () => {
  it("u35_complete_logs_no_read_touch_and_does_not_open_the_drawer", async () => {
    const { app, connected } = await mountTodos([todo(3)]);
    await screen.findByText(/todo 3/);
    rowOf(3).querySelector<HTMLButtonElement>(".todo-row-button")!.focus();

    fireEvent.click(within(rowOf(3)).getByRole("checkbox"));
    await waitFor(() => expect(callsTo(app, "todo.complete")).toHaveLength(1));

    expect([callsTo(app, "todo.get"), connected.drawer.content()]).toEqual([[], null]);
  });

  it("u3807_each_site_shows_its_message_in_the_reserved_line: Todo row", async () => {
    const { app } = await mountTodos(shelf());
    await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #5 session store/ });
    const place = rowOf(5).querySelector(".reserved-line")!;
    const siblings = [...place.parentElement!.children];
    const failure = new RpcError(-32003, "cannot complete");
    app.handlers["todo.complete"] = () => Promise.reject(failure);

    rowOf(5).querySelector<HTMLButtonElement>(".todo-row-button")!.focus();
    fireEvent.click(within(rowOf(5)).getByRole("checkbox"));

    expect((await screen.findByRole("alert")).textContent).toContain(failure.message);
    expect([...place.parentElement!.children]).toEqual(siblings);
    app.handlers["todo.complete"] = () => new Promise(() => {});
    fireEvent.click(within(rowOf(5)).getByRole("checkbox"));
    expect(screen.getByRole("alert").textContent).toContain(failure.message);
    expect(rowOf(5).querySelector(".reserved-line")).toBe(place);
    expect([...place.parentElement!.children]).toEqual(siblings);
  });

  it("u35_a_failed_complete_still_calls_todo_complete_with_the_rows_id", async () => {
    const { app } = await mountTodos(shelf());
    await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #5 session store/ });
    const failure = new RpcError(-32003, "cannot complete");
    app.handlers["todo.complete"] = () => Promise.reject(failure);

    rowOf(5).querySelector<HTMLButtonElement>(".todo-row-button")!.focus();
    fireEvent.click(within(rowOf(5)).getByRole("checkbox"));
    await screen.findByText(/cannot complete/);

    expect(callsTo(app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 5 } }]);
  });

  it("u35_a_successful_complete_leaves_the_row_unchanged_until_todo_updated_arrives", async () => {
    const { app } = await mountTodos([todo(3)]);
    await screen.findByText(/todo 3/);

    rowOf(3).querySelector<HTMLButtonElement>(".todo-row-button")!.focus();
    fireEvent.click(within(rowOf(3)).getByRole("checkbox"));
    await waitFor(() => expect(callsTo(app, "todo.complete")).toHaveLength(1));

    expect([callsTo(app, "todo.list"), screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #\d+ todo 3/ }).textContent]).toEqual([
      [{ method: "todo.list", params: null }],
      "todo 3",
    ]);
  });

  it("u35_todo_updated_after_a_successful_complete_refetches_the_list_and_removes_the_row", async () => {
    const { app, store } = await mountTodos([todo(3)]);
    await screen.findByText(/todo 3/);
    rowOf(3).querySelector<HTMLButtonElement>(".todo-row-button")!.focus();
    fireEvent.click(within(rowOf(3)).getByRole("checkbox"));
    await waitFor(() => expect(callsTo(app, "todo.complete")).toHaveLength(1));

    store.todos = [todo(3, { done: true })];
    app.emit(todoEvent("todo.updated", todo(3, { done: true })));

    await waitFor(() => expect(screen.queryByRole("button", { name: /^(?:Idle|Blocked|Done) #3/ })).toBeNull());
    expect(callsTo(app, "todo.list")).toHaveLength(2);
  });

  it("p3557c_an_unrelated_shelf_click_keeps_the_row_failure", async () => {
    const { app } = await mountTodos(shelf());
    await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #5 session store/ });
    const failure = new RpcError(-32003, "cannot complete");
    app.handlers["todo.complete"] = () => Promise.reject(failure);
    rowOf(5).querySelector<HTMLButtonElement>(".todo-row-button")!.focus();
    fireEvent.click(within(rowOf(5)).getByRole("checkbox"));
    await screen.findByText(/cannot complete/);

    fireEvent.click(rowOf(4));

    expect(screen.getByRole("alert").textContent).toContain(failure.message);
  });

  it("u35_moving_focus_from_the_row_to_complete_keeps_it_visible_and_clickable", async () => {
    const { app } = await mountTodos([todo(3)]);
    const row = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #3/ });

    row.focus();
    const completeButton = screen.getByRole("checkbox", { name: "Complete todo 3" });

        completeButton.focus();

    expect([document.activeElement, completeButton.isConnected]).toEqual([completeButton, true]);

    fireEvent.click(completeButton);

    await waitFor(() => expect(callsTo(app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 3 } }]));
  });

  it("u35_a_blocked_rows_depth_changes_only_once_todo_unblocked_refetches_the_list", async () => {
    const { app, store } = await mountTodos([todo(5, { title: "session store", blocked: true, blockers: [4] }), todo(4, { title: "migrate" })]);
    await screen.findByRole("tree");

    fireEvent.contextMenu(rowOf(4));
    await app.pickMenu("Complete");
    await waitFor(() => expect(callsTo(app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 4 } }]));
    store.todos = [todo(5, { title: "session store" }), todo(4, { title: "migrate", done: true })];

    // No todo.updated for #5: unblocking only ever reaches the webview as todo.unblocked (T3).
    expect(rowOf(5).getAttribute("aria-level")).toBe("2");

    app.emit({ actor: USER, name: "todo.unblocked", data: { id: 5 } });

    await waitFor(() => expect(rowOf(5).getAttribute("aria-level")).toBe("1"));
  });



});
