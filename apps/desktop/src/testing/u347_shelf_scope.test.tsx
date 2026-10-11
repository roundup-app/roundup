import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";
import { DrawerHost } from "../drawer/DrawerHost";
import { Pads } from "../pads/Pads";
import { Rail } from "../rail/Rail";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { Todos } from "../todos/Todos";
import { todo } from "../todos/testHarness";
import { createFakeApp } from "./fakeApp";
import type { RailNode } from "@contracts/agent/RailNode";
import { agent, door, event, NOW, USER, workstream } from "./nodes";
import { padHandlers, todoHandlers } from "./stores";
import type { PadStore, TodoStore } from "./stores";

afterEach(cleanup);

const padAt = (name: string, home: string | null): Pad => ({ name, owner: USER, text: "", updated_at: 0, home, scribe: null });

const TREE = [workstream("w", { name: "mine" }), workstream("o", { name: "other", order: 1 }), agent("a1", "idle", "ann", { parent: "w" })];

const TODOS: Todo[] = [todo(1, { home: "w" }), todo(2, { home: "w" }), todo(3, { home: null }), todo(4, { home: "o" })];

const PADS = [padAt("w-one", "w"), padAt("root", null), padAt("o-one", "o")];

const mount = async (pads: Pad[] = PADS, todos: Todo[] = TODOS) => {
  const padState: PadStore = { pads, history: [] };
  const store: TodoStore = { todos };
  const app = createFakeApp();
  const calls: string[] = [];

  app.handlers["rail.tree"] = () => TREE;
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

  return { connected, calls };
};

const todoIds = () => [...document.querySelectorAll("[aria-label=todos] [data-shelf-row]")].map((row) => row.getAttribute("data-id"));

const padNames = () => [...document.querySelectorAll("[aria-label=pads] .pad-name")].map((row) => row.textContent);

describe("u347 a Workstream's Shelf shows its own Todos and Pads until the user asks for all", () => {
  it("u347_selecting_a_workstream_lists_only_its_own_todos_and_pads", async () => {
    const { connected } = await mount();

    await connected.rail.settled();
    connected.rail.select("w");

    await waitFor(() => expect(todoIds()).toEqual(["1", "2"]));
    expect(padNames()).toEqual(["w-one"]);
    expect(screen.queryByText("root")).toBeNull();
    expect(screen.queryByText("o-one")).toBeNull();
    expect(screen.getByRole("button", { name: "this one" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("u347_all_lists_every_one_and_leaving_and_returning_reads_this_one", async () => {
    const { connected } = await mount();

    connected.rail.select("w");
    fireEvent.click(await screen.findByRole("button", { name: "all" }));

    await waitFor(() => expect(todoIds()).toEqual(["1", "2", "3", "4"]));
    expect(padNames()).toEqual(["w-one", "root", "o-one"]);

    connected.rail.select("a1");
    connected.rail.select("w");

    await waitFor(() => expect(todoIds()).toEqual(["1", "2"]));
    expect(screen.getByRole("button", { name: "this one" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("u347_an_agent_selected_shows_no_pair_and_lists_only_what_a_running_agent_owns", async () => {
    const mine = { kind: "agent" as const, id: "a1", parent: null };

    const { connected } = await mount(
      [{ ...padAt("ann-pad", null), owner: mine }, ...PADS],
      [...TODOS, todo(5, { creator: mine })],
    );

    connected.rail.select("a1");

    await waitFor(() => expect(todoIds()).toEqual(["5"]));
    expect(screen.queryByRole("group", { name: "show Todos" })).toBeNull();
    expect(padNames()).toEqual(["ann-pad"]);
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
    expect(screen.getByRole("button", { name: "all" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("u347_a_project_with_nothing_keeps_the_u15_and_u38_lines", async () => {
    const { connected } = await mount([], []);

    connected.rail.select("w");

    expect(await screen.findByText("no todos yet")).toBeTruthy();
    expect(screen.getByText("no pads yet")).toBeTruthy();
  });

  describe("no Workstream selected", () => {
    const RUNNING_TREE = [
      workstream("w", { name: "mine" }),
      door("d", "working", "working", { name: "door", order: 1 }),
      agent("run", "idle", "ann", { order: 2 }),
      agent("stopped", "done", "bob", { order: 3, terminal_id: null }),
    ];

    const by = (id: string) => ({ kind: "agent" as const, id, parent: null });

    const mountRunning = async (pads: Pad[], todos: Todo[]) => {
      const padState: PadStore = { pads, history: [] };
      const store: TodoStore = { todos };
      const app = createFakeApp();
      let tree: RailNode[] = RUNNING_TREE;

      app.handlers["rail.tree"] = () => tree;
      Object.assign(app.handlers, padHandlers(padState, (data) => app.emit(event(data))));
      Object.assign(app.handlers, todoHandlers(store, (data) => app.emit(event(data))));

      const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => NOW);

      render(() => (
        <ConnectedProjectContext.Provider value={connected}>
          <Todos />
          <Pads />
        </ConnectedProjectContext.Provider>
      ));
      await connected.rail.settled();

      return { app, connected, setTree: (next: RailNode[]) => (tree = next) };
    };

    it("u347_only_what_a_running_agent_owns_is_listed", async () => {
      await mountRunning(
        [
          { ...padAt("run-pad", null), owner: by("run") },
          padAt("door-pad", "d"),
          padAt("user-pad", null),
          { ...padAt("stopped-pad", null), owner: by("stopped") },
        ],
        [todo(1, { creator: by("run") }), todo(2), todo(3, { creator: by("stopped") }), todo(4, { creator: by("run"), done: true })],
      );

      await waitFor(() => expect(todoIds()).toEqual(["1"]));
      expect(padNames()).toEqual(["run-pad", "door-pad"]);
      expect(screen.queryByText("user-pad")).toBeNull();
      expect(screen.queryByText("stopped-pad")).toBeNull();
    });

    it("u347_stopping_the_running_agent_removes_its_rows", async () => {
      const { app, setTree } = await mountRunning([{ ...padAt("run-pad", null), owner: by("run") }], [todo(1, { creator: by("run") })]);

      await waitFor(() => expect(todoIds()).toEqual(["1"]));

      setTree(RUNNING_TREE.map((node) => (node.id === "run" ? { ...node, terminal_id: null } : node)));
      app.emit(event({ name: "rail.changed" }));

      await waitFor(() => expect(todoIds()).toEqual([]));
      expect(padNames()).toEqual([]);
      expect(screen.getByText("no todos from running agents")).toBeTruthy();
      expect(screen.getByText("no pads from running agents")).toBeTruthy();
    });

    it("u347_a_project_with_nothing_keeps_u15_and_u38_lines", async () => {
      await mountRunning([], []);

      expect(await screen.findByText("no todos yet")).toBeTruthy();
      expect(screen.getByText("no pads yet")).toBeTruthy();
    });
  });
});
