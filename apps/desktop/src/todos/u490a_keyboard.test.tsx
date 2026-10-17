import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import type { Todo } from "@contracts/todo/Todo";
import { DrawerHost } from "../drawer/DrawerHost";
import { Keys } from "../keys/Keys";
import { rowOf } from "../rail/railFixture";
import { Rail } from "../rail/Rail";
import { RpcError } from "../app/seam";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent, event, NOW } from "../testing/nodes";
import { showEverything, withScopeRow } from "../testing/showEverything";
import { todoHandlers } from "../testing/stores";
import type { TodoStore } from "../testing/stores";
import { beforeOf } from "./beforeOf";
import { movedBy } from "./sortedList";
import { Todos } from "./Todos";
import { mountTodos, todo, todoCallsTo as callsTo, todoEvent } from "./testHarness";

afterEach(cleanup);

type Mounted = Awaited<ReturnType<typeof mountTodos>>;

const ids = (root: ParentNode = document, rows = "[data-shelf-row] .todo-row-button") => [...root.querySelectorAll(rows)].map((row) => Number(/#(\d+)/.exec(row.getAttribute("aria-label") ?? "")![1]));

const buttonOf = (id: number) => screen.getByRole<HTMLButtonElement>("button", { name: new RegExp(`^(Idle|Blocked) #${id} `) });

const refetch = ({ app, store }: Mounted) => app.emit(todoEvent("todo.updated", { ...store.todos[0]! }));

const three = () => mountTodos([todo(1), todo(2, { blocked: true, blockers: [4] }), todo(3), todo(4, { done: true })]);

describe("u490a Alt+Up and Alt+Down order a Todo row", () => {
  it("u490a_keyboard_reorders", async () => {
    const mounted = await three();

    await screen.findByText(/todo 3/);
    buttonOf(1).focus();
    fireEvent.keyDown(buttonOf(1), { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(callsTo(mounted.app, "todo.reorder")).toEqual([{ method: "todo.reorder", params: { id: 1, before: 3 } }]));
    refetch(mounted);
    await waitFor(() => expect(ids()).toEqual([2, 1, 3]));
    expect(document.activeElement).toBe(buttonOf(1));

    fireEvent.keyDown(buttonOf(3), { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(buttonOf(2), { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(buttonOf(1), { key: "ArrowDown" });
    expect(callsTo(mounted.app, "todo.reorder")).toHaveLength(1);
  });

  it("u490a_keyboard_reorders_a_failed_call_shows_the_message_and_keeps_the_order", async () => {
    const mounted = await three();

    mounted.app.handlers["todo.reorder"] = () => {
      throw new RpcError(-32000, "no room");
    };

    await screen.findByText(/todo 3/);
    buttonOf(1).focus();
    fireEvent.keyDown(buttonOf(1), { key: "ArrowDown", altKey: true });
    await screen.findByText(/no room/);
    expect(ids()).toEqual([1, 2, 3]);
    expect(document.activeElement).toBe(buttonOf(1));
  });

  it("u490a_the_done_fold_takes_no_alt_key", async () => {
    const mounted = await three();

    fireEvent.click(await screen.findByRole("button", { name: /1 done/ }));

    const done = await screen.findByRole("button", { name: /^Done #4 / });

    expect(done.getAttribute("aria-description")).toBeNull();
    fireEvent.keyDown(done, { key: "ArrowUp", altKey: true });
    expect(callsTo(mounted.app, "todo.reorder")).toEqual([]);
  });
});

const by = (id: string): Actor => ({ kind: "agent", id, parent: null });

const mountNested = async (todos: Todo[]) => {
  const store: TodoStore = { todos };
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => withScopeRow([agent("a1", "working", "x", { name: "auth" })]);
  Object.assign(app.handlers, todoHandlers(store, (data) => app.emit(event(data))));

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => NOW);

  await showEverything(connected);
  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Keys />
      <Rail />
      <Todos />
      <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
    </ConnectedProjectContext.Provider>
  ));
  await connected.rail.settled();
  fireEvent.click(await waitFor(() => within(rowOf("auth")).getByRole("button", { name: /todos$/ })));

  return { app, store };
};

describe("u490a an Agent's list orders within itself", () => {
  it("u490a_nested_order_boundary", async () => {
    // The Shelf holds #1, #2 and #6; the Agent's list is #3, #4, #5; #6 follows the list in `todo.list`.
    const { app } = await mountNested([todo(1), todo(2), todo(3, { creator: by("a1") }), todo(4, { creator: by("a1") }), todo(5, { creator: by("a1") }), todo(6)]);
    const group = await waitFor(() => document.querySelector<HTMLElement>("[data-pads]") ?? Promise.reject(new Error("no list")));

    await waitFor(() => expect(ids(group, ".todo-row-button")).toEqual([3, 4, 5]));

    const key = (id: number, key: string) => fireEvent.keyDown(within(group).getByRole("button", { name: new RegExp(`#${id} `) }), { key, altKey: true });

    key(3, "ArrowUp");
    key(5, "ArrowDown");
    expect(callsTo(app, "todo.reorder")).toEqual([]);
    key(4, "ArrowDown");
    await waitFor(() => expect(callsTo(app, "todo.reorder")).toEqual([{ method: "todo.reorder", params: { id: 4, before: 6 } }]));
    key(5, "ArrowUp");
    await waitFor(() => expect(callsTo(app, "todo.reorder")).toHaveLength(2));
    expect(callsTo(app, "todo.reorder")[1]).toEqual({ method: "todo.reorder", params: { id: 5, before: 4 } });
    expect(ids(screen.getByRole("region", { name: "Todos" }))).toEqual([1, 2, 6]);
  });

  it("u490a_nested_order_boundary_names_the_row_the_new_order_moved", () => {
    const all = [1, 2, 3, 4, 5].map((id) => todo(id));

    expect(beforeOf(all, [2, 4], 4, 0)).toBe(2);
    expect(beforeOf(all, [2, 4], 2, 1)).toBe(5);
    expect(beforeOf(all.slice(0, 4), [2, 4], 2, 1)).toBeNull();
    expect(movedBy(["1", "2", "3"], ["3", "1", "2"])).toBe("3");
    expect(movedBy(["1", "2", "3"], ["2", "3", "1"])).toBe("1");
    expect(movedBy(["1", "2", "3"], ["1", "2", "3"])).toBeUndefined();
  });
});
