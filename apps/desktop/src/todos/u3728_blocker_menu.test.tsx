import { createMemo, createSignal } from "solid-js";
import { ConnectedProjectContext } from "../state/connectedProject";
import { TodoMeta } from "./TodoMeta";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { blockerGraph, blockerChoices } from "./todoView";
import { mountTodos, todo, todoCallsTo } from "./testHarness";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const openMenu = async (todos = [todo(1, { title: "alpha" }), todo(2, { title: "beta" }), todo(3, { title: "gamma" })], id = 1) => {
  const mounted = await mountTodos(todos);
  { const focusedRow = await screen.findByRole("button", { name: new RegExp(`^(Idle|Blocked) #${id} `) }); focusedRow.focus(); fireEvent.keyDown(focusedRow, { key: "Enter", code: "Enter" }); }

  const button = await within(panel()).findByRole("button", { name: /^Blocked by/ });
  fireEvent.click(button);
  await screen.findByRole("combobox");

  return { ...mounted, button };
};

const rows = () => screen.queryAllByRole("option").map((option) => option.textContent);

it("u3728_blocker_menu_filters_picks_and_escapes", async () => {
  const { app, button } = await openMenu();
  expect(within(panel()).queryByRole("option")).toBeNull();
  const input = screen.getByRole("combobox");
  input.focus();
  fireEvent.input(input, { target: { value: "#3" } });
  await waitFor(() => expect(rows()).toEqual(["gamma#3"]));
  fireEvent.input(input, { target: { value: "bet" } });
  await waitFor(() => expect(rows()).toEqual(["beta#2"]));
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  expect(todoCallsTo(app, "todo.setBlockers")).toHaveLength(0);
  expect(document.activeElement).toBe(button);

  fireEvent.click(button);
  fireEvent.input(await screen.findByRole("combobox"), { target: { value: "gam" } });
  await waitFor(() => expect(rows()).toEqual(["gamma#3"]));
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  await waitFor(() => expect(todoCallsTo(app, "todo.setBlockers").map((call) => call.params)).toEqual([{ id: 1, blockers: [3], expected_change: 1 }]));
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  expect(panel().contains(document.activeElement)).toBe(true);
});

it("u3515c_blockers_exclude_self_existing_and_transitive_cycles", async () => {
  // 2 waits on 1 (a cycle if 1 waited on 2); 3 waits on 2 (a longer cycle); 4 is already a blocker of 1; 5 is free.
  await openMenu([todo(4), todo(1, { blockers: [4], blocked: true }), todo(2, { blockers: [1], blocked: true }), todo(3, { blockers: [2], blocked: true }), todo(5, { title: "free" })], 1);
  expect(rows()).toEqual(["todo 4#4", "free#5"]);
});


it.each([80, 160, 2000])("u5644c_both_menus_bound_graph_work chain %i", count => {
  let sourceReads = 0;
  const work = { vertex: 0, edge: 0, candidate: 0 };

  const all = Array.from({ length: count }, (_, at) => {
    const item = todo(at + 1);
    const blockers = at ? [at] : [];
    Object.defineProperty(item, "blockers", { get() { sourceReads++;

 return blockers; } });

    return item;
  });

  const graph = blockerGraph(all);
  const choices = blockerChoices(all[0]!, graph, kind => { work[kind]++; });
  expect(choices.offeredBlockers).toEqual([]);
  expect(choices.offeredBlocking.map(item => item.id)).toEqual(all.slice(2).map(item => item.id));
  expect(sourceReads).toBeLessThanOrEqual(2 * (count + count - 1));
  // The selected root is expanded once in each direction; every other chain vertex once.
  expect(work.vertex).toBeLessThanOrEqual(count + 1);
  expect(work.edge).toBeLessThanOrEqual(count - 1);
  expect(work.candidate).toBeLessThanOrEqual(8 * (count + count - 1));
});

it.each([
  { name: "non-id chain and done", list: [todo(4), todo(2, { blockers: [1], done: true }), todo(1), todo(3, { blockers: [2] })], id: 1, expected: [[], [2], [4], [4, 3]] },
  { name: "wide direct exclusions", list: [todo(4), todo(3, { blockers: [1] }), todo(1), todo(2, { blockers: [1] })], id: 1, expected: [[], [2, 3], [4], [4]] },
  { name: "converging diamond", list: [todo(4, { blockers: [2, 3] }), todo(3, { blockers: [1] }), todo(2, { blockers: [1] }), todo(1), todo(5)], id: 4, expected: [[2, 3], [], [1, 5], [5]] },
  { name: "unrelated cycle and missing", list: [todo(5, { blockers: [6] }), todo(6, { blockers: [5] }), todo(3, { blockers: [99] }), todo(2, { blockers: [1], done: true }), todo(1, { blockers: [98] })], id: 1, expected: [[], [2], [3, 5, 6], [5, 6, 3]] },
  { name: "selected cycle with secondary edge", list: [todo(4), todo(3, { blockers: [2, 99] }), todo(2, { blockers: [1] }), todo(1, { blockers: [3] })], id: 1, expected: [[3], [2], [4], [4]] },
])("u5644c_candidates_match_both_existing_directions $name", ({ list, id, expected }) => {
  const choice = blockerChoices(list.find(item => item.id === id)!, blockerGraph(list));
  expect([choice.blockers, choice.blocking, choice.offeredBlockers, choice.offeredBlocking].map(items => items.map(item => item.id))).toEqual(expected);
});

it("u5644c_both_menus_bound_graph_work wide cycles diamond and missing", () => {
  const fixtures = [
    Array.from({ length: 2000 }, (_, at) => todo(at + 1, { blockers: at ? [1, 9999] : [] })),
    [todo(1, { blockers: [3, 99] }), todo(2, { blockers: [1] }), todo(3, { blockers: [2] })],
    [todo(1), todo(2, { blockers: [1] }), todo(3, { blockers: [1] }), todo(4, { blockers: [2, 3] })],
  ];

  for (const all of fixtures) {
    const graph = blockerGraph(all);
    const visits = new Map<number, number>();
    const work = { vertex: 0, edge: 0, candidate: 0 };
    blockerChoices(all[0]!, graph, (kind, id) => {
      work[kind]++;

      if (kind === "vertex") visits.set(id, (visits.get(id) ?? 0) + 1);
    });
    const edges = all.reduce((sum, item) => sum + item.blockers.length, 0);
    expect(Math.max(...visits.values())).toBeLessThanOrEqual(2);
    expect(work.edge).toBeLessThanOrEqual(2 * edges);
    expect(work.candidate).toBeLessThanOrEqual(8 * (all.length + edges));
  }
});

it("u5644c_both_menu_directions_keep_edge_calls_and_focus", async () => {
  const mounted = await openMenu([todo(1), todo(2, { title: "beta" }), todo(3, { blockers: [1], done: true })]);
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  const blocking = within(panel()).getByRole("button", { name: /^Blocking/ });
  fireEvent.click(blocking);
  const input = await screen.findByRole("combobox");
  fireEvent.input(input, { target: { value: "bet" } });
  await waitFor(() => expect(rows()).toEqual(["beta#2"]));
  fireEvent.click(screen.getByRole("option"));
  await waitFor(() => expect(todoCallsTo(mounted.app, "todo.setBlockers").map(call => call.params)).toEqual([{ id: 2, blockers: [1], expected_change: 2 }]));
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  expect(document.activeElement).toBe(blocking);
  fireEvent.click(blocking);
  await screen.findByRole("combobox");
  fireEvent.click(screen.getByRole("option", { name: /todo 3/ }));
  await waitFor(() => expect(todoCallsTo(mounted.app, "todo.setBlockers").map(call => call.params)).toEqual([
    { id: 2, blockers: [1], expected_change: 2 }, { id: 3, blockers: [], expected_change: 3 },
  ]));
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  expect(document.activeElement).toBe(blocking);
});


it("u5644c_both_menus_bound_graph_work across opening filtering selection and refetch", async () => {
  const { connected } = await mountTodos([]);
  let sourceReads = 0;

  const counted = (id: number, blockers: number[]) => {
    const item = todo(id);
    Object.defineProperty(item, "blockers", { get() { sourceReads++;

 return blockers; } });

    return item;
  };

  const original = [counted(1, []), counted(2, [1]), counted(3, [])];
  const [all, setAll] = createSignal(original);
  const [selected, setSelected] = createSignal(original[0]!);

  const mounted = render(() => {
    const graph = createMemo(() => blockerGraph(all()));

    return <ConnectedProjectContext.Provider value={connected}>
    <TodoMeta todo={selected()} graph={graph()} toggle={async () => null} change={() => {}} owner="Unassigned" assign={() => {}} fail={() => {}} />
  </ConnectedProjectContext.Provider>;
  });

  // One build reads three source blocker lists; one direct-edge set reads the selection.
  expect(sourceReads).toBe(4);

  const open = async (direction: "Blocked by" | "Blocking") => {
    const button = within(mounted.container).getByRole("button", { name: new RegExp(`^${direction}`) });
    fireEvent.click(button);

    return screen.findByRole("combobox");
  };

  const close = async (input: HTMLElement) => {
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  };

  for (const direction of ["Blocked by", "Blocking", "Blocked by"] as const) {
    const input = await open(direction);
    fireEvent.input(input, { target: { value: "#3" } });
    await waitFor(() => expect(rows()).toEqual(["todo 3#3"]));
    await close(input);
  }

  expect(sourceReads).toBe(4);
  setSelected(original[1]!);
  expect(sourceReads).toBe(5);
  const input = await open("Blocked by");
  expect(rows()).toEqual(["todo 1#1", "todo 3#3"]);
  await close(input);
  const replacement = [counted(1, [2]), counted(2, []), counted(3, [2])];
  setAll(replacement);
  setSelected(replacement[1]!);
  const updated = await open("Blocked by");
  expect(rows()).toEqual([]);
  await close(updated);
  // Replacement builds once; changing selection only reads that selection's direct edges.
  expect(sourceReads).toBe(10);
  const reverse = await open("Blocking");
  expect(rows()).toEqual(["todo 1#1", "todo 3#3"]);
  await close(reverse);
  expect(sourceReads).toBe(10);
});
