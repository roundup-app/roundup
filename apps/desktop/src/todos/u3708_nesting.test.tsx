import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { SCOPE_ROW } from "../testing/nodes";
import { RpcError } from "../app/seam";
import { mountTodos, todo, todoCallsTo as callsTo, todoEvent, todoRowOf as rowOf } from "./testHarness";

afterEach(cleanup);

const levelOf = (id: number) => Number(rowOf(id).closest("[role=treeitem]")?.getAttribute("aria-level"));

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
    expect(within(rowOf(2)).getByRole("img", { name: "Blocked" })).toBeTruthy();
  });

  it("u3810_locked_rows_name_only_open_blockers_and_open_their_drawers (u3708_the_other_blockers_show_as_one_quiet_line)", async () => {
    const { app } = await mountTodos([todo(1, { title: "a" }), todo(2, { title: "b" }), todo(3, { blocked: true, blockers: [1, 2] }), todo(4, { blocked: true, blockers: [1] })]);
    await screen.findByRole("tree");
    const line = rowOf(3).querySelector<HTMLElement>("[data-todo-also-waits]")!;

    expect(within(line).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["Open blocker a", "Open blocker b"]);
    expect(levelOf(3)).toBe(2);
    expect(within(rowOf(4)).getByRole("button", { name: "Open blocker a" })).toBeTruthy();
    expect(within(rowOf(3)).getByRole("img", { name: "Blocked" })).toBeTruthy();
    fireEvent.click(within(rowOf(3)).getByRole("button", { name: "Open blocker b" }));
    await screen.findByRole("complementary", { name: "Drawer" });
    await waitFor(() => expect(callsTo(app, "todo.getHistory").at(-1)?.params).toEqual({ id: 2 }));
  });

  it("u3708_the_list_is_a_tree_of_treeitems_with_levels", async () => {
    await mountTodos([todo(1), todo(2, { blocked: true, blockers: [1] })]);
    await screen.findAllByRole("treeitem");
    const list = document.querySelector<HTMLElement>(".todo-list");
    const tree = within(list!).getByRole("tree");
    const items = [...document.querySelectorAll<HTMLElement>("[data-level]")];

    expect(tree.getAttribute("data-scope")).toBe("tree-view");
    expect(items.every((item) => item.closest("[role=tree]") === tree)).toBe(true);

    expect(within(tree).getAllByRole("treeitem")).toHaveLength(2);
    expect(items.map((item) => item.closest("[role=treeitem]")?.getAttribute("aria-level"))).toEqual(["1", "2"]);
    expect(screen.getByRole("button", { name: "Toggle todo 1 group" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("u3809_ticking_a_parent_keeps_its_dependency_group", async () => {
    const { app, store } = await mountTodos([todo(1), todo(2, { blocked: true, blockers: [1] })]);

    await screen.findByRole("tree");
    fireEvent.click(within(rowOf(1)).getByRole("checkbox"));
    await waitFor(() => expect(callsTo(app, "todo.complete")).toHaveLength(1));
    store.todos = store.todos.map((t) => (t.id === 1 ? { ...t, done: true } : t.id === 2 ? { ...t, blocked: false } : t));
    app.emit(todoEvent("todo.updated", store.todos[0]!));
    app.emit(todoEvent("todo.updated", store.todos[1]!));

    await waitFor(() => expect(levelOf(2)).toBe(2));
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

  it("u3809_disclosure_toggles_only_its_inert_contents (u3809_closed_groups_preserve_focus_and_done_rows_are_not_duplicated)", async () => {
    const mounted = await mountTodos([todo(1), todo(2, { blockers: [1] }), todo(3, { done: true, blockers: [1] })]);
    const disclosure = await screen.findByRole("button", { name: "Toggle todo 1 group" });
    within(rowOf(2)).getByRole("checkbox").focus();
    fireEvent.click(disclosure);
    await waitFor(() => expect(disclosure.getAttribute("aria-expanded")).toBe("false"));
    expect(document.activeElement).toBe(disclosure);
    expect(screen.queryByRole("checkbox", { name: "Complete todo 2" })).toBeNull();
    expect(callsTo(mounted.app, "todo.complete")).toHaveLength(0);
    fireEvent.click(disclosure);
    expect(await screen.findByRole("checkbox", { name: "Complete todo 2" })).toBeTruthy();
    expect(document.querySelectorAll('[data-todo="3"]')).toHaveLength(1);
  });
});


describe("u3811 completion advances the visible dependency groups", () => {
  const setup = async (reduced = true, candidates = 2) => mountTodos([
    todo(1, { done: true }), todo(2, { blockers: [1] }),
    todo(3, { done: true }), todo(4, { blockers: [3, 2, ...(candidates === 0 ? [7] : [])], blocked: true }),
    todo(5, { done: true }), todo(6, { blockers: [5, 2, ...(candidates < 2 ? [7] : [])], blocked: true }), todo(7),
  ], reduced);

  const disclosure = (id: number) => screen.getByRole("button", { name: `Toggle todo ${id} group` });

  const accept = async (mounted: Awaited<ReturnType<typeof setup>>) => {
    mounted.store.todos = mounted.store.todos.map(item => item.id === 2 ? { ...item, done: true } : item);
    mounted.store.todos = mounted.store.todos.map(item => ({ ...item, blocked: item.blockers.some(id => mounted.store.todos.some(blocker => blocker.id === id && !blocker.done)) }));
    mounted.app.emit(todoEvent("todo.updated", mounted.store.todos[1]!));
    await mounted.todos.reload();
  };

  it.each([0, 1, 2])("u3811_final_child_folds_and_opens_only_the_first_newly_unblocked_group (%s candidates)", async candidates => {
    const mounted = await setup(true, candidates);
    fireEvent.click(disclosure(3));
    fireEvent.click(disclosure(5));
    await waitFor(() => expect(disclosure(5).getAttribute("aria-expanded")).toBe("false"));
    await accept(mounted);
    expect(disclosure(1).getAttribute("aria-expanded")).toBe("false");
    expect(disclosure(3).getAttribute("aria-expanded")).toBe(candidates > 0 ? "true" : "false");
    expect(disclosure(5).getAttribute("aria-expanded")).toBe("false");
    expect(callsTo(mounted.app, "todo.complete")).toHaveLength(0);
  });

  it("u3811_final_child_keeps_its_finish_and_repairs_only_hidden_focus", async () => {
    const mounted = await setup(false);
    buttonOf(2).focus();
    await accept(mounted);
    expect(disclosure(1).getAttribute("aria-expanded")).toBe("true");
    fireEvent.animationEnd(rowOf(2).querySelector('.todo-strike')!);
    expect(disclosure(1).getAttribute("aria-expanded")).toBe("true");

    for (const fill of document.querySelectorAll(".app-progress-fill")) fireEvent.transitionEnd(fill, { propertyName: "transform" });
    await waitFor(() => expect(disclosure(1).getAttribute("aria-expanded")).toBe("false"));
    expect(document.activeElement).toBe(buttonOf(4));
  });

  it("u3811_mount_navigation_and_folded_updates_settle_without_replay", async () => {
    const mounted = await setup(false);
    fireEvent.click(disclosure(1));
    fireEvent.click(disclosure(3));
    await waitFor(() => expect(disclosure(1).getAttribute("aria-expanded")).toBe("false"));
    await accept(mounted);
    expect(document.querySelector('[data-motion="play"]')).toBeNull();
    expect(disclosure(3).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure(1));
    expect(document.querySelector('[data-motion="play"]')).toBeNull();
    expect(await screen.findByRole("checkbox", { name: "Reopen todo 2" })).toBeTruthy();
  });

  it("u3811_mount_navigation_and_folded_updates_settle_without_replay (leave mid-finish and return)", async () => {
    const mounted = await setup(false);
    fireEvent.click(disclosure(3));
    await waitFor(() => expect(disclosure(3).getAttribute("aria-expanded")).toBe("false"));
    await accept(mounted);
    mounted.connected.rail.select(SCOPE_ROW);
    await waitFor(() => expect(screen.queryByRole("progressbar", { name: "Todos done" })).toBeNull());
    mounted.connected.rail.select(null);
    await screen.findByRole("progressbar", { name: "Todos done" });
    const owner = document.querySelector<HTMLElement>('[data-shelf-group="unassigned"] [data-part="branch-control"]')!;

    if (owner.closest('[aria-expanded]')?.getAttribute("aria-expanded") === "false") fireEvent.click(owner);
    await screen.findByRole("button", { name: "Toggle todo 1 group" });
    expect(disclosure(1).getAttribute("aria-expanded")).toBe("false");
    expect(disclosure(3).getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[data-motion="play"]')).toBeNull();
  });

  it("u3811_an_agent_finish_keeps_focus_outside_the_closing_group", async () => {
    const mounted = await setup();
    const add = screen.getByRole("button", { name: "add todo to Overview" });
    add.focus();
    await accept(mounted);
    expect(disclosure(1).getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(add);
  });

  it("u3811_reduced_motion_settles_groups_without_waiting_for_motion", async () => {
    const mounted = await setup(false);
    await accept(mounted);
    mounted.setReduced(true);
    expect(disclosure(1).getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[data-motion="play"]')).toBeNull();
  });
});


it("u3810_locked_ticks_keep_the_same_calls_refetch_and_failure", async () => {
  const mounted = await mountTodos([todo(1), todo(2, { blockers: [1], blocked: true })]);
  const tick = await screen.findByRole<HTMLInputElement>("checkbox", { name: "Complete todo 2" });
  tick.focus();
  mounted.app.handlers["todo.complete"] = () => { throw new RpcError(-32003, "completion refused; retry"); };

  fireEvent.click(tick);
  await within(rowOf(2)).findByRole("alert");
  expect(tick.checked).toBe(false);
  expect(document.activeElement).toBe(tick);
  expect(callsTo(mounted.app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 2 } }]);
  expect(callsTo(mounted.app, "todo.setBlockers")).toHaveLength(0);
});

it("u3809_membership_counts_each_descendant_once_across_completion", async () => {
  const mounted = await mountTodos([todo(1), todo(2, { blockers: [1] }), todo(3, { blockers: [2, 1] }), todo(4)]);
  await screen.findByRole("progressbar", { name: "Todos done in todo 1" });
  const progress = () => screen.getByRole("progressbar", { name: "Todos done in todo 1" });
  expect(progress().getAttribute("aria-valuemax")).toBe("2");
  mounted.store.todos = [todo(1, { done: true }), todo(2, { blockers: [1], done: true }), todo(3, { blockers: [2, 1] }), todo(4)];
  await mounted.todos.reload();
  expect(progress().getAttribute("aria-valuenow")).toBe("1");
  expect(document.querySelectorAll('[data-todo="2"]')).toHaveLength(1);
  mounted.store.todos = [todo(1, { done: true }), todo(3, { blockers: [1] }), todo(4)];
  await mounted.todos.reload();
  expect(progress().getAttribute("aria-valuemax")).toBe("1");
  mounted.store.todos = [todo(1, { done: true }), todo(3), todo(4)];
  await mounted.todos.reload();
  expect(screen.queryByRole("progressbar", { name: "Todos done in todo 1" })).toBeNull();
});


it("u3811_bursts_and_reopening_settle_on_the_latest_facts", async () => {
  const mounted = await mountTodos([todo(1, { done: true }), todo(2, { blockers: [1] }), todo(3, { done: true }), todo(4, { blockers: [3, 2], blocked: true })], false);
  const first = await screen.findByRole("button", { name: "Toggle todo 1 group" });
  const next = screen.getByRole("button", { name: "Toggle todo 3 group" });
  fireEvent.click(next);
  await waitFor(() => expect(next.getAttribute("aria-expanded")).toBe("false"));
  mounted.store.todos = [todo(1, { done: true }), todo(2, { blockers: [1], done: true }), todo(3, { done: true }), todo(4, { blockers: [3, 2] })];
  await mounted.todos.reload();
  mounted.store.todos = [todo(1, { done: true }), todo(2, { blockers: [1] }), todo(3, { done: true }), todo(4, { blockers: [3, 2], blocked: true })];
  await mounted.todos.reload();
  fireEvent.animationEnd(rowOf(2).querySelector('.todo-strike')!);

  for (const fill of document.querySelectorAll(".app-progress-fill")) fireEvent.transitionEnd(fill, { propertyName: "transform" });
  expect(first.getAttribute("aria-expanded")).toBe("true");
  expect(next.getAttribute("aria-expanded")).toBe("false");
  expect(within(rowOf(2)).getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  expect(document.querySelector('[data-motion="play"]')).toBeNull();
});

it("u3811_bursts_and_reopening_settle_on_the_latest_facts (a hidden completed group precedes the successor)", async () => {
  const mounted = await mountTodos([
    todo(1, { done: true }), todo(2, { blockers: [1] }),
    todo(3, { done: true }), todo(4, { blockers: [3, 2], blocked: true }),
    todo(5, { done: true }), todo(6, { blockers: [5] }),
    todo(7, { done: true }), todo(8, { blockers: [7, 6], blocked: true }),
  ]);

  const disclosure = (id: number) => screen.getByRole("button", { name: `Toggle todo ${id} group` });

  await screen.findByRole("button", { name: "Toggle todo 3 group" });

  for (const id of [3, 5, 7]) {
    fireEvent.click(disclosure(id));
    await waitFor(() => expect(disclosure(id).getAttribute("aria-expanded")).toBe("false"));
  }

  mounted.store.todos = mounted.store.todos.map(item => ({ ...item, done: item.done || item.id === 2 || item.id === 6, blocked: false }));
  await mounted.todos.reload();
  expect(disclosure(3).getAttribute("aria-expanded")).toBe("false");
  expect(disclosure(5).getAttribute("aria-expanded")).toBe("false");
  expect(disclosure(7).getAttribute("aria-expanded")).toBe("true");
});
