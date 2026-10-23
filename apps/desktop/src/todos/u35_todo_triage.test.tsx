import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { USER } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo as callsTo, todoEvent, todoRowOf as rowOf } from "./testHarness";

afterEach(cleanup);

const drawer = () => screen.getByRole("complementary", { name: "Drawer" });

const blocked = () => todo(5, { title: "session store", blocked: true, blockers: [6, 4] });

const shelf = () => [blocked(), todo(4, { title: "migrate" }), todo(6, { title: "later" })];

describe("u35 Todo triage without the Drawer", () => {
  it("u35_hovering_an_open_row_keeps_the_tick_box_which_calls_todo_complete", async () => {
    const { app } = await mountTodos([todo(3)]);
    await screen.findByText(/todo 3/);

    fireEvent.mouseEnter(rowOf(3));
    fireEvent.click(within(rowOf(3)).getByRole("checkbox"));

    await waitFor(() => expect(callsTo(app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 3 } }]));
  });

  it("u35_no_complete_word_once_the_row_is_no_longer_hovered", async () => {
    await mountTodos([todo(3)]);
    await screen.findByText(/todo 3/);
    fireEvent.mouseEnter(rowOf(3));
    await screen.findByRole("checkbox", { name: "Complete todo 3" });

    fireEvent.mouseLeave(rowOf(3));

    expect(screen.queryByText("Complete")).toBeNull();
  });

  it("u35_focusing_an_open_row_keeps_the_tick_box", async () => {
    await mountTodos([todo(3)]);
    const row = await screen.findByRole("button", { name: /#3/ });

    fireEvent.focusIn(row);

    expect(screen.getByRole("checkbox", { name: "Complete todo 3" })).toBeTruthy();
  });


  it("u35_no_complete_word_once_focus_moves_to_another_row", async () => {
    await mountTodos([todo(3), todo(4)]);
    const row3Button = await screen.findByRole("button", { name: /#3/ });
    row3Button.focus();
    await within(rowOf(3)).findByRole("checkbox");
    const row4Button = screen.getByRole("button", { name: /#4/ });

    row4Button.focus();

    expect(within(rowOf(3)).queryByText("Complete")).toBeNull();
  });

  it("u35_complete_logs_no_read_touch_and_does_not_open_the_drawer", async () => {
    const { app, connected } = await mountTodos([todo(3)]);
    await screen.findByText(/todo 3/);
    fireEvent.mouseEnter(rowOf(3));

    fireEvent.click(within(rowOf(3)).getByRole("checkbox"));
    await waitFor(() => expect(callsTo(app, "todo.complete")).toHaveLength(1));

    expect([callsTo(app, "todo.get"), connected.drawer.content()]).toEqual([[], null]);
  });

  it("u35_a_blockers_title_opens_that_blockers_drawer_and_not_the_blocked_todos_own_drawer", async () => {
    await mountTodos(shelf());
    await screen.findByRole("button", { name: "Open blocker migrate" });

    fireEvent.click(screen.getByRole("button", { name: "Open blocker migrate" }));

    await within(drawer()).findByText("Blocker");
    // #4 has no blockers of its own; a "Waits on" section would mean #5's drawer opened instead.
    expect([
      within(drawer()).queryByText("Waits on"),
      within(drawer()).getByText("Blocks").nextElementSibling?.textContent,
    ]).toEqual([null, " #5  session store"]);
  });

  it("u35_a_blockers_title_click_opens_the_drawer_exactly_once", async () => {
    const { connected } = await mountTodos(shelf());
    await screen.findByRole("button", { name: "Open blocker migrate" });
    const opened: unknown[] = [];
    const open = connected.drawer.open.bind(connected.drawer);
    connected.drawer.open = (content) => {
      opened.push(content);
      open(content);
    };

    fireEvent.click(screen.getByRole("button", { name: "Open blocker migrate" }));

    expect(opened).toHaveLength(1);
  });

  it("u35_the_blockers_title_is_reachable_by_keyboard", async () => {
    await mountTodos(shelf());
    await screen.findByRole("button", { name: "Open blocker migrate" });

    expect(screen.getByRole("button", { name: "Open blocker migrate" }).closest("button")).not.toBeNull();
  });

  it("u3807_each_site_shows_its_message_in_the_reserved_line: Todo row", async () => {
    const { app } = await mountTodos(shelf());
    await screen.findByRole("button", { name: "Open blocker migrate" });
    const description = rowOf(5).querySelector("[data-todo-also-waits]")!;
    const place = rowOf(5).querySelector(".reserved-line")!;
    const siblings = [...place.parentElement!.children];
    app.handlers["todo.complete"] = () => Promise.reject(new RpcError(-32000, "cannot complete"));

    fireEvent.mouseEnter(rowOf(5));
    fireEvent.click(within(rowOf(5)).getByRole("checkbox"));

    expect((await screen.findByText(/cannot complete/)).textContent).toBe("cannot complete");
    expect(description.isConnected).toBe(true);
    expect([...place.parentElement!.children]).toEqual(siblings);
    app.handlers["todo.complete"] = () => new Promise(() => {});
    fireEvent.click(within(rowOf(5)).getByRole("checkbox"));
    expect(screen.queryByText(/cannot complete/)).toBeNull();
    expect(rowOf(5).querySelector(".reserved-line")).toBe(place);
    expect([...place.parentElement!.children]).toEqual(siblings);
  });

  it("u35_a_failed_complete_still_calls_todo_complete_with_the_rows_id", async () => {
    const { app } = await mountTodos(shelf());
    await screen.findByRole("button", { name: "Open blocker migrate" });
    app.handlers["todo.complete"] = () => Promise.reject(new RpcError(-32000, "cannot complete"));

    fireEvent.mouseEnter(rowOf(5));
    fireEvent.click(within(rowOf(5)).getByRole("checkbox"));
    await screen.findByText(/cannot complete/);

    expect(callsTo(app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 5 } }]);
  });

  it("u35_an_open_rows_text_at_rest_never_includes_complete", async () => {
    await mountTodos([todo(3)]);
    await screen.findByText(/todo 3/);

    expect(rowOf(3).querySelector(".todo-row-button")?.textContent).toBe("todo 3");
    expect(rowOf(3).textContent).not.toContain("Complete");
    expect(screen.queryByText("Complete")).toBeNull();
  });

  it("u35_a_successful_complete_leaves_the_row_unchanged_until_todo_updated_arrives", async () => {
    const { app } = await mountTodos([todo(3)]);
    await screen.findByText(/todo 3/);

    fireEvent.mouseEnter(rowOf(3));
    fireEvent.click(within(rowOf(3)).getByRole("checkbox"));
    await waitFor(() => expect(callsTo(app, "todo.complete")).toHaveLength(1));

    expect([callsTo(app, "todo.list"), screen.getByRole("button", { name: /todo 3/ }).textContent]).toEqual([
      [{ method: "todo.list", params: null }],
      "todo 3",
    ]);
  });

  it("u35_todo_updated_after_a_successful_complete_refetches_the_list_and_removes_the_row", async () => {
    const { app, store } = await mountTodos([todo(3)]);
    await screen.findByText(/todo 3/);
    fireEvent.mouseEnter(rowOf(3));
    fireEvent.click(within(rowOf(3)).getByRole("checkbox"));
    await waitFor(() => expect(callsTo(app, "todo.complete")).toHaveLength(1));

    store.todos = [todo(3, { done: true })];
    app.emit(todoEvent("todo.updated", todo(3, { done: true })));

    await waitFor(() => expect(screen.queryByRole("button", { name: /#3/ })).toBeNull());
    expect(callsTo(app, "todo.list")).toHaveLength(2);
  });

  it("u35_a_click_anywhere_in_the_shelf_clears_another_rows_failure", async () => {
    const { app } = await mountTodos(shelf());
    await screen.findByRole("button", { name: "Open blocker migrate" });
    app.handlers["todo.complete"] = () => Promise.reject(new RpcError(-32000, "cannot complete"));
    fireEvent.mouseEnter(rowOf(5));
    fireEvent.click(within(rowOf(5)).getByRole("checkbox"));
    await screen.findByText(/cannot complete/);

    fireEvent.click(rowOf(4));

    expect(screen.queryByText(/cannot complete/)).toBeNull();
  });

  it("u35_moving_focus_from_the_row_to_complete_keeps_it_visible_and_clickable", async () => {
    const { app } = await mountTodos([todo(3)]);
    const row = await screen.findByRole("button", { name: /#3/ });

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

    fireEvent.mouseEnter(rowOf(4));
    fireEvent.click(within(rowOf(4)).getByRole("checkbox"));
    await waitFor(() => expect(callsTo(app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 4 } }]));
    store.todos = [todo(5, { title: "session store" }), todo(4, { title: "migrate", done: true })];

    // No todo.updated for #5: unblocking only ever reaches the webview as todo.unblocked (T3).
    expect(rowOf(5).getAttribute("aria-level")).toBe("2");

    app.emit({ actor: USER, name: "todo.unblocked", data: { id: 5 } });

    await waitFor(() => expect(rowOf(5).getAttribute("aria-level")).toBe("1"));
  });

  it("u35_a_rows_shelf_click_listener_is_removed_once_the_shelf_unmounts", async () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = await mountTodos([todo(3)]);
    await screen.findByText(/todo 3/);
    const added = addSpy.mock.calls.filter(([type]) => type === "click").length;

    unmount();

    const removed = removeSpy.mock.calls.filter(([type]) => type === "click").length;
    expect([added > 0, removed]).toEqual([true, added]);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

});
