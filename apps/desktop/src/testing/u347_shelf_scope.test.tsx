import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";
import { DrawerHost } from "../drawer/DrawerHost";
import { Pads } from "../pads/Pads";
import { Rail } from "../rail/Rail";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { Todos } from "../todos/Todos";
import { todo } from "../todos/testHarness";
import { createFakeApp } from "./fakeApp";
import type { Actor } from "@contracts/Actor";
import { agent, door, event, NOW, USER, workstream } from "./nodes";
import { padHandlers, todoHandlers } from "./stores";
import type { PadStore, TodoStore } from "./stores";

afterEach(cleanup);

const padAt = (name: string, home: string | null): Pad => ({ name, owner: USER, text: "", updated_at: 0, home });

const TREE = [workstream("w", { name: "mine" }), workstream("o", { name: "other", order: 1 }), agent("a1", "idle", "ann", { parent: "w" })];

const TODOS: Todo[] = [todo(1, { home: "w" }), todo(2, { home: "w" }), todo(3, { home: null }), todo(4, { home: "o" })];

const PADS = [padAt("w-one", "w"), padAt("root", null), padAt("o-one", "o")];

const mount = async (pads: Pad[] = PADS, todos: Todo[] = TODOS, tree: RailNode[] = TREE) => {
  const padState: PadStore = { pads, history: [] };
  const store: TodoStore = { todos };
  const app = createFakeApp();
  const calls: string[] = [];

  app.handlers["rail.tree"] = () => tree;
  Object.assign(app.handlers, padHandlers(padState, (data) => app.emit(event(data))));
  Object.assign(app.handlers, todoHandlers(store, (data) => app.emit(event(data))));

  const moveTodo = app.handlers["todo.move"]!;
  const movePad = app.handlers["pad.move"]!;

  app.handlers["todo.move"] = (params) => {
    calls.push(`todo.move ${JSON.stringify(params)}`);

    return moveTodo(params);
  };

  app.handlers["pad.move"] = (params) => {
    calls.push(`pad.move ${JSON.stringify(params)}`);

    return movePad(params);
  };

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => NOW);

  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Rail />
      <Todos />
      <Pads />
      <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
    </ConnectedProjectContext.Provider>
  ));
  await connected.rail.settled();

  return { app, connected, calls };
};

const todoIds = () => [...document.querySelectorAll("[aria-label=todos] [data-shelf-row]")].map((row) => row.getAttribute("data-id"));

const padNames = () => [...document.querySelectorAll("[aria-label=pads] .pad-name")].map((row) => row.textContent);

describe("u347 a Workstream's Shelf shows its own Todos and Pads until the user asks for all", () => {
  it("u347_selecting_a_workstream_lists_only_its_own_todos_and_pads", async () => {
    const { connected } = await mount();

    connected.rail.select("w");

    await waitFor(() => expect(todoIds()).toEqual(["1", "2"]));
    expect(padNames()).toEqual(["w-one"]);
    expect(screen.queryByText("root")).toBeNull();
    expect(screen.queryByText("o-one")).toBeNull();
    expect(screen.getByRole("radio", { name: "this one" })).toHaveProperty("checked", true);
  });

  it("u347_all_lists_every_one_and_leaving_and_returning_reads_this_one", async () => {
    const { connected } = await mount();

    connected.rail.select("w");
    fireEvent.click(await screen.findByRole("radio", { name: "all" }));

    await waitFor(() => expect(todoIds()).toEqual(["1", "2", "3", "4"]));
    expect(padNames()).toEqual(["w-one", "root", "o-one"]);

    connected.rail.select("a1");
    connected.rail.select("w");

    await waitFor(() => expect(todoIds()).toEqual(["1", "2"]));
    expect(screen.getByRole("radio", { name: "this one" })).toHaveProperty("checked", true);
  });

  it("u347_an_agent_selected_shows_no_pair_and_lists_only_what_a_running_agent_owns", async () => {
    const { connected } = await mount();

    connected.rail.select("a1");

    expect(await screen.findByText("no todos from running agents")).toBeTruthy();
    expect(screen.getByText("no pads from running agents")).toBeTruthy();
    expect(todoIds()).toEqual([]);
    expect(padNames()).toEqual([]);
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("u347_no_workstream_lists_what_a_running_agent_or_running_door_owns", async () => {
    const ann: Actor = { kind: "agent", id: "a1", parent: null };
    const bob: Actor = { kind: "agent", id: "a2", parent: null };
    const gone: Actor = { kind: "agent", id: "a3", parent: null };
    const tree = [door("w", "idle", "door"), workstream("o", { name: "other", order: 1 }), agent("a1", "idle", "ann"), agent("a2", "idle", "bob", { terminal_id: null }), agent("a3", "done", "cy", { terminal_id: null })];

    const todos = [todo(1, { creator: ann }), todo(2, { creator: USER }), todo(3, { creator: bob }), todo(4, { creator: gone }), todo(5, { creator: ann, done: true })];

    const pads = [
      { ...padAt("ann-pad", null), owner: ann },
      { ...padAt("door-pad", "w") },
      padAt("other-pad", "o"),
      { ...padAt("bob-pad", null), owner: bob },
      padAt("mine", null),
    ];

    const { connected } = await mount(pads, todos, tree);

    await waitFor(() => expect(todoIds()).toEqual(["1"]));
    expect(padNames()).toEqual(["ann-pad", "door-pad"]);
    expect(screen.queryByRole("radio")).toBeNull();

    connected.rail.select("a1");
    await Promise.resolve();
    expect(todoIds()).toEqual(["1"]);
  });

  it("u347_stopping_the_running_agent_removes_its_rows", async () => {
    const ann: Actor = { kind: "agent", id: "a1", parent: null };
    const state = { tree: [agent("a1", "idle", "ann")] };
    const { app } = await mount([{ ...padAt("ann-pad", null), owner: ann }], [todo(1, { creator: ann })], state.tree);

    await waitFor(() => expect(todoIds()).toEqual(["1"]));
    expect(padNames()).toEqual(["ann-pad"]);

    state.tree[0] = agent("a1", "done", "ann", { terminal_id: null });
    app.handlers["rail.tree"] = () => state.tree;
    app.emit(event({ name: "rail.changed" }));

    expect(await screen.findByText("no todos from running agents")).toBeTruthy();
    expect(todoIds()).toEqual([]);
    expect(padNames()).toEqual([]);
  });

  it("u347_adding_from_the_shelf_moves_the_new_todo_and_pad_to_the_workstream", async () => {
    const { connected, calls } = await mount([], []);

    connected.rail.select("w");
    fireEvent.click(await screen.findByRole("button", { name: "add todo" }));

    const title = await screen.findByRole("textbox", { name: "new todo title" });

    fireEvent.input(title, { target: { value: "ship" } });
    fireEvent.keyDown(title, { key: "Enter" });
    await waitFor(() => expect(calls).toContain('todo.move {"id":1,"home":"w"}'));
    await waitFor(() => expect(todoIds()).toEqual(["1"]));

    fireEvent.click(screen.getByRole("button", { name: "add pad" }));

    const name = await screen.findByRole("textbox", { name: "pad name" });

    fireEvent.input(name, { target: { value: "notes" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(calls).toContain('pad.move {"name":"notes","home":"w"}'));
    await waitFor(() => expect(padNames()).toEqual(["notes"]));
  });

  it("u347_empty_scoped_lists_read_their_lines_and_show_all_chooses_all", async () => {
    const { connected } = await mount([padAt("root", null)], [todo(3, { home: null })]);

    connected.rail.select("w");

    const pads = await screen.findByRole("region", { name: "pads" });
    const todos = screen.getByRole("region", { name: "todos" });

    expect(await within(todos).findByText(/no todos in this workstream/)).toBeTruthy();
    expect(within(pads).getByText(/no pads in this workstream/)).toBeTruthy();

    fireEvent.click(within(pads).getByRole("button", { name: "show all" }));

    await waitFor(() => expect(todoIds()).toEqual(["3"]));
    expect(padNames()).toEqual(["root"]);
    expect(screen.getByRole("radio", { name: "all" })).toHaveProperty("checked", true);
  });

  it("u347_a_project_with_nothing_keeps_the_u15_and_u38_lines", async () => {
    const { connected } = await mount([], []);

    connected.rail.select("w");

    expect(await screen.findByText("no todos yet")).toBeTruthy();
    expect(screen.getByText("no pads yet")).toBeTruthy();
  });
});
