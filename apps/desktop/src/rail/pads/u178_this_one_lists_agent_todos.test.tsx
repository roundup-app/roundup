import { DisplayClockContext } from "../../state/clock";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { showEverything, withScopeRow } from "../../testing/showEverything";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@contracts/Actor";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";
import { DrawerHost } from "../../drawer/DrawerHost";
import { Pads } from "../../pads/Pads";
import { ConnectedProjectContext, connectProject } from "../../state/connectedProject";
import { createFakeApp } from "../../testing/fakeApp";
import { agent, event, NOW, workstream } from "../../testing/nodes";
import { padHandlers, todoHandlers } from "../../testing/stores";
import type { PadStore, TodoStore } from "../../testing/stores";
import { Todos } from "../../todos/Todos";
import { todo } from "../../todos/testHarness";
import * as topology from "../../state/railTopology";
import { copy } from "../copy";
import * as todoList from "../../todos/todoList";
import { rowOf, settled } from "../railFixture";
import { Rail } from "../Rail";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const by = (id: string): Actor => ({ kind: "agent", id, parent: null });

const padOf = (name: string): Pad => ({ incarnation: `fixture-${name}`, name, text: "", updated_at: 0, revision: 1, home: null });

const mount = async (tree: RailNode[], todos: Todo[], pads: Pad[] = [], railOnly = false) => {
  const padState: PadStore = { pads, history: [] };
  const store: TodoStore = { todos };
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => withScopeRow(tree);
  Object.assign(app.handlers, padHandlers(padState, (data) => app.emit(event(data))));
  Object.assign(app.handlers, todoHandlers(store, (data) => app.emit(event(data))));

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => NOW);
  await showEverything(connected);

  render(() => (
    <DisplayClockContext.Provider value={() => () => 0}><ConnectedProjectContext.Provider value={connected}>
      <Rail />
      {railOnly ? null : <><Pads /><Todos /></>}
      <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
    </ConnectedProjectContext.Provider></DisplayClockContext.Provider>
  ));

  await connected.rail.settled();

  return { app, store, connected };
};

const TREE = [
  workstream("w1", { name: "ship" }),
  workstream("w2", { name: "other", order: 1 }),
  agent("a1", "working", "x", { name: "auth", parent: "w1" }),
  agent("a2", "working", "x", { name: "docs", parent: "w1", order: 1 }),
  agent("a3", "working", "x", { name: "misc", parent: "w2" }),
];

describe("u178 this one lists every open Todo of the Workstream", () => {


  it("u178_the_control_is_named_by_what_it_holds", async () => {
    await mount(TREE, [todo(2, { home: "w1", creator: by("a1") }), todo(3, { home: "w1", creator: by("a2") })], [padOf("n")]);

    const named = async (row: string, name: string) => {
      const button = await waitFor(() => within(document.querySelector(`.rail-row[data-id="${row}"]`)!).getByRole("button", { name }));

      fireEvent.keyDown(document, { key: "Tab" });
      button.focus();
      await waitFor(() => expect(screen.getAllByRole("tooltip").map((tip) => tip.textContent)).toContain(name));
      button.blur();
      await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    };

    await named("a1", "1 todos");
    await named("a2", "1 todos");
  });


});

// Instrument reads of the real shared list only in the Rail-only mount. No Shelf/Drawer scan
// is charged to this pass, and the production counter (not a test double) consumes every item.
const observeVisits = () => {
  let visits = 0;
  const original = todoList.useTodoList;
  vi.spyOn(todoList, "useTodoList").mockImplementation(() => {
    const list = original();

    return { ...list, all: () => {
      const observed = [...list.all()];
      observed[Symbol.iterator] = function* (): Generator<Todo, undefined, unknown> {
        for (const todo of list.all()) { visits += 1; yield todo; }

        return undefined;
      };

      return observed;
    } };
  });

  return { read: () => visits, reset: () => { visits = 0; } };
};

const countedTodos = () => [
  todo(1, { creator: by("a0"), owner: by("a1") }),
  todo(2, { creator: by("a0"), done: true }),
  todo(3, { creator: { kind: "user", id: "you", parent: null }, owner: by("a0") }),
  todo(4, { creator: by("unmounted") }),
];

it.each([1, 10, 40])("u5645b_one_todo_pass_counts_creators_for_every_agent (%i Agents)", async count => {
  const visits = observeVisits();
  const nodes = Array.from({ length: count }, (_, at) => agent(`a${at}`, "working", "x", { order: at }));
  const { connected } = await mount(nodes, countedTodos(), [], true);
  const control = await waitFor(() => within(rowOf("a0")).getByRole("button", { name: "2 todos" }));
  expect(visits.read()).toBe(4);

  for (let at = 1; at < count; at += 1) expect(rowOf(`a${at}`).querySelector("[data-pads-control]")).toBeNull();
  fireEvent.click(control);
  await settled();
  expect(connected.padsOwner()).toBe("a0");
  expect(connected.padsTab()).toBe("todos");
  expect(visits.read()).toBe(4);
});

it("u5645b_todo_revisions_update_counts_without_row_rescans", async () => {
  const construction = vi.spyOn(topology, "railTopology");
  const visits = observeVisits();
  const nodes = [agent("a0", "working", "x"), agent("a1", "working", "x", { order: 1 })];
  const { connected, app, store } = await mount(nodes, countedTodos(), [], true);
  await waitFor(() => within(rowOf("a0")).getByRole("button", { name: copy.todoCount(2) }));
  expect(visits.read()).toBe(4);
  const built = construction.mock.calls.length;
  fireEvent.click(rowOf("a0"));
  rowOf("a0").focus();
  await settled();
  const row = rowOf("a0");
  const node = connected.rail.nodes.find(node => node.id === "a0");
  visits.reset();

  const refresh = async (todos: Todo[], expected: number[]) => {
    store.todos = todos;
    app.emit(event({ name: "todo.updated", data: todos[0]! }));
    await waitFor(() => expect(visits.read()).toBe(todos.length));

    for (const [at, count] of expected.entries()) {
      const control = rowOf(`a${at}`).querySelector("[data-pads-control]");
      expect(control?.getAttribute("aria-label") ?? null).toBe(count ? copy.todoCount(count) : null);
    }

    expect(construction.mock.calls.length).toBe(built);
    expect(rowOf("a0")).toBe(row);
    expect(connected.rail.nodes.find(node => node.id === "a0")).toBe(node);
    expect(document.activeElement).toBe(row);
    expect(connected.rail.selected()).toBe("a0");
    visits.reset();
  };

  await refresh([...countedTodos(), todo(5, { creator: by("a1") })], [2, 1]);
  await refresh([...countedTodos().map(todo => ({ ...todo, done: true })), todo(5, { creator: by("a1") })], [2, 1]);
  await refresh([countedTodos()[0]!, countedTodos()[2]!, countedTodos()[3]!], [1, 0]);
  await refresh([todo(1, { creator: by("a1") }), countedTodos()[2]!, countedTodos()[3]!], [0, 1]);
  app.handlers["rail.tree"] = () => [...nodes, agent("extra", "working", "x")];
  await connected.rail.refresh();
  connected.rail.select("a1");
  await settled();
  expect(rowOf("extra")).toBeTruthy();
  expect(visits.read()).toBe(0);
  expect(construction.mock.calls.length).toBe(built + 1);
});
