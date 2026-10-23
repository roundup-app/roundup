import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { mountTodos, todo, todoCallsTo as callsTo, todoEvent, todoRowOf as rowOf } from "./testHarness";

afterEach(cleanup);

const levelOf = (id: number) => Number(rowOf(id).getAttribute("aria-level"));

const ids = () => [...document.querySelectorAll<HTMLElement>("[data-level]")].map((row) => Number(row.dataset.id));

const buttonOf = (id: number) => within(rowOf(id)).getByRole<HTMLButtonElement>("button", { name: new RegExp(`^(Idle|Blocked|Done) #${id}\\b`) });

describe("u3708 the Todos list is a tree drawn from blockers", () => {
  it("u3708_depth_is_read_from_the_first_blocker", async () => {
    await mountTodos([
      todo(1), todo(2, { blocked: true, blockers: [1] }), todo(3, { blocked: true, blockers: [2] }),
      todo(4, { blocked: true, blockers: [99] }),
    ]);
    await screen.findByRole("tree");

    expect(ids()).toEqual([1, 2, 3, 4]);
    expect([1, 2, 3, 4].map(levelOf)).toEqual([1, 2, 3, 1]);
    expect(within(rowOf(2)).queryByRole("img", { name: "Blocked" })).toBeNull();
  });

  it("u3708_the_other_blockers_show_as_one_quiet_line", async () => {
    await mountTodos([todo(1, { title: "a" }), todo(2, { title: "b" }), todo(3, { blocked: true, blockers: [1, 2] }), todo(4, { blocked: true, blockers: [1] })]);
    await screen.findByRole("tree");
    const line = rowOf(3).querySelector<HTMLElement>("[data-todo-also-waits]")!;

    expect(line.textContent).toBe("also waits on: b");
    expect(levelOf(3)).toBe(2);
    expect(rowOf(4).querySelector("[data-todo-also-waits]")).toBeNull();
    expect(rowOf(3).textContent).not.toContain("Waits on");
    expect(within(rowOf(3)).getByRole("button", { name: "Open blocker b" })).toBeTruthy();
  });

  it("u3708_the_list_is_a_tree_of_treeitems_with_levels", async () => {
    await mountTodos([todo(1), todo(2, { blocked: true, blockers: [1] })]);
    await screen.findAllByRole("treeitem");
    const list = document.querySelector<HTMLElement>(".todo-list");
    const tree = within(list!).getByRole("tree");
    const items = [...document.querySelectorAll<HTMLElement>("[data-level]")];

    expect(tree.getAttribute("data-scope")).toBe("tree-view");
    expect(items.every((item) => item.closest("[role=tree]") === tree)).toBe(true);

    expect(items.map((item) => item.getAttribute("role"))).toEqual(["treeitem", "treeitem"]);
    expect(items.map((item) => item.getAttribute("aria-level"))).toEqual(["1", "2"]);
    expect(items.every((item) => !item.hasAttribute("aria-expanded"))).toBe(true);
  });

  it("u3708_ticking_a_parent_unnests_its_children", async () => {
    const { app, store } = await mountTodos([todo(1), todo(2, { blocked: true, blockers: [1] })]);

    await screen.findByRole("tree");
    fireEvent.click(within(rowOf(1)).getByRole("checkbox"));
    await waitFor(() => expect(callsTo(app, "todo.complete")).toHaveLength(1));
    store.todos = store.todos.map((t) => (t.id === 1 ? { ...t, done: true } : t.id === 2 ? { ...t, blocked: false } : t));
    app.emit(todoEvent("todo.updated", store.todos[0]!));
    app.emit(todoEvent("todo.updated", store.todos[1]!));

    await waitFor(() => expect(levelOf(2)).toBe(1));
    await waitFor(() => expect(document.activeElement).toBe(buttonOf(2)));
  });
});

describe("u3709 Tab nests a row and shift Tab un-nests it", () => {
  it("u3709_tab_nests_under_the_row_above_and_calls_set_blockers_once", async () => {
    const { app, store } = await mountTodos([todo(1), todo(2, { blocked: true, blockers: [7] }), todo(7, { done: true })]);

    await screen.findByRole("tree");
    buttonOf(2).focus();
    fireEvent.keyDown(buttonOf(2), { key: "Tab" });

    await waitFor(() => expect(callsTo(app, "todo.setBlockers")).toEqual([{ method: "todo.setBlockers", params: { id: 2, blockers: [1, 7] } }]));
    app.emit(todoEvent("todo.updated", store.todos[1]!));
    await waitFor(() => expect(levelOf(2)).toBe(2));
    expect(document.activeElement).toBe(buttonOf(2));
  });

  it("u3709_shift_tab_removes_the_first_blocker", async () => {
    const { app, store } = await mountTodos([todo(1), todo(2, { blocked: true, blockers: [1] }), todo(3, { blocked: true, blockers: [1] })]);

    await screen.findByRole("tree");
    buttonOf(2).focus();
    fireEvent.keyDown(buttonOf(2), { key: "Tab", shiftKey: true });

    await waitFor(() => expect(callsTo(app, "todo.setBlockers")).toEqual([{ method: "todo.setBlockers", params: { id: 2, blockers: [] } }]));
    app.emit(todoEvent("todo.updated", store.todos[1]!));
    await waitFor(() => expect(levelOf(2)).toBe(1));
  });

  it("u3709_tab_elsewhere_moves_focus_as_before", async () => {
    const { app } = await mountTodos([todo(1), todo(2)]);

    await screen.findByRole("tree");
    buttonOf(1).focus();
    expect(fireEvent.keyDown(buttonOf(1), { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(buttonOf(1), { key: "Tab", shiftKey: true })).toBe(true);
    expect(callsTo(app, "todo.setBlockers")).toEqual([]);
  });
});

describe("u3711 a move that would make a cycle is refused and says why", () => {
  it("u3711_a_refused_move_returns_the_row_and_shows_the_cause", async () => {
    const { app, store } = await mountTodos([todo(1), todo(2)]);

    app.handlers["todo.setBlockers"] = () => { throw new RpcError(-32003, "todo 1 would wait on itself through todo 2"); };

    await screen.findByRole("tree");
    buttonOf(2).focus();
    fireEvent.keyDown(buttonOf(2), { key: "Tab" });

    await waitFor(() => expect(within(rowOf(2)).getByRole("alert").textContent).toBe("todo 1 would wait on itself through todo 2"));
    expect(within(rowOf(2)).getByRole("alert").querySelector("svg")).not.toBeNull();
    expect(ids()).toEqual([1, 2]);
    expect(document.activeElement).toBe(buttonOf(2));

    fireEvent.click(document.body);
    expect(within(rowOf(2)).getByRole("alert")).toBeTruthy();
    store.todos = store.todos.map((item) => item.id === 1 ? { ...item, title: "renamed" } : item);
    app.emit(todoEvent("todo.updated", store.todos[0]!));
    await waitFor(() => expect(buttonOf(1).textContent).toBe("renamed"));
    expect(within(rowOf(2)).queryByRole("alert")).toBeNull();
  });

  it("u3711_the_webview_never_checks_for_a_cycle", async () => {
    const { app } = await mountTodos([todo(1, { blocked: true, blockers: [2] }), todo(2, { blocked: true, blockers: [1] })]);

    app.handlers["todo.setBlockers"] = () => { throw new RpcError(-32003, "todo 2 would wait on itself through todo 1"); };

    await screen.findAllByRole("treeitem");
    buttonOf(2).focus();
    fireEvent.keyDown(buttonOf(2), { key: "Tab" });

    await waitFor(() => expect(within(rowOf(2)).getByRole("alert").textContent).toMatch(/would wait on itself/));
    expect(callsTo(app, "todo.setBlockers")).toHaveLength(1);
  });
});

describe("u3712 the Waits on line is gone", () => {
  it("u3712_a_blocked_row_has_no_waits_on_line_and_a_centred_marker", async () => {
    await mountTodos([todo(1), todo(2, { blocked: true, blockers: [1] }), todo(3, { blocked: true, blockers: [99] })]);
    await screen.findByRole("tree");

    expect(document.querySelector("[data-todo-waits]")).toBeNull();
    expect(rowOf(2).textContent).not.toMatch(/waits on/i);
    expect(within(rowOf(2)).queryByRole("img", { name: "Blocked" })).toBeNull();
    expect(within(rowOf(3)).getByRole("img", { name: "Blocked" })).toBeTruthy();
  });
});


describe("u3809 dependency groups retain their members", () => {
  it("u3809_group_and_scope_progress_have_distinct_membership", async () => {
    await mountTodos([todo(1), todo(2, { done: true, blockers: [1] }), todo(3, { blockers: [1] }), todo(4, { blockers: [2] })]);
    const group = await screen.findByRole("progressbar", { name: "Todos done in todo 1" });
    expect(group.getAttribute("aria-valuenow")).toBe("1");
    expect(group.getAttribute("aria-valuemax")).toBe("3");
    expect(screen.getByRole("progressbar", { name: "Todos done in todo 2" }).getAttribute("aria-valuemax")).toBe("1");
    expect(screen.getByRole("progressbar", { name: "Todos done" }).getAttribute("aria-valuemax")).toBe("4");
    expect(document.querySelectorAll('[data-todo="2"]')).toHaveLength(1);
  });

  it("u3809_disclosure_toggles_only_its_inert_contents", async () => {
    const mounted = await mountTodos([todo(1), todo(2, { blockers: [1] })]);
    const disclosure = await screen.findByRole("button", { name: "Toggle todo 1 group" });
    within(rowOf(2)).getByRole("checkbox").focus();
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(disclosure);
    expect(screen.queryByRole("checkbox", { name: "Complete todo 2" })).toBeNull();
    expect(callsTo(mounted.app, "todo.complete")).toHaveLength(0);
    fireEvent.click(disclosure);
    expect(screen.getByRole("checkbox", { name: "Complete todo 2" })).toBeTruthy();
  });
});
