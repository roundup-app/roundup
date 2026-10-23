import { createSignal, type Accessor } from "solid-js";
import { expect } from "vitest";
import { within, render, fireEvent, waitFor } from "@solidjs/testing-library";
import type { Event as DaemonEvent } from "@contracts/Event";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Todo } from "@contracts/todo/Todo";
import { Layout } from "../app/Layout";
import { DrawerHost } from "../drawer/DrawerHost";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { event, USER } from "../testing/nodes";
import { showEverything, withScopeRow } from "../testing/showEverything";
import { todoHandlers } from "../testing/stores";
import type { TodoStore } from "../testing/stores";
import { Todos } from "./Todos";
import { useTodoList } from "./todoList";
import type { TodosState } from "./state";
import { Rail } from "../rail/Rail";

export const todo = (id: number, over: Partial<Todo> = {}): Todo => ({
  id,
  title: `todo ${id}`,
  body: "",
  done: false,
  blockers: [],
  blocked: false,
  created_at: 0,
  creator: USER,
  home: null,
  owner: null,
  refs: [],
  estimate_minutes: null,
  ...over,
});

export const todoEvent = (name: "todo.created" | "todo.updated", data: Todo): DaemonEvent => event({ name, data });

/** The Shelf's Todos and the Drawer host over a fake Daemon whose `todo.list` answers `store.todos`. */
export const mountTodos = async (initial: Todo[], reducedMotion = true, rail: RailNode[] = [], renderRail = false, path = `/test-todos/${crypto.randomUUID()}`, clock: Accessor<number> = () => 0) => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => withScopeRow(rail);
  const store: TodoStore = { todos: initial };
  Object.assign(app.handlers, todoHandlers(store, () => {}));

  const [reduced, setReduced] = createSignal(reducedMotion);
  const connected = await connectProject(app, { name: "p", path }, reduced, clock);

  await showEverything(connected);


  let todos!: TodosState;

  const Shelf = () => {
    todos = useTodoList();

    return <Todos />;
  };

  const { unmount } = render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Layout
        header="roundup"
        rail={renderRail ? <Rail /> : null}
        centre={null}
        shelf={<Shelf />}
        overlay={<DrawerHost drawer={connected.drawer} reducedMotion={reduced} />}
      />
    </ConnectedProjectContext.Provider>
  ));

  if (initial.length > 0) await waitFor(() => expect(document.querySelector(".shelf-groups [data-part=branch-control], .shelf-done-line")).not.toBeNull());
  const disclosure = document.querySelector<HTMLElement>('[data-shelf-group="unassigned"] [data-part="branch-control"]');

  const unassigned = initial.some(todo => !todo.done && (todo.owner === null || (todo.owner.kind === "agent" && !rail.some(node => node.id === todo.owner?.id))));

  if (disclosure && unassigned) fireEvent.click(disclosure);

  return { app, store, connected, todos, unmount, setReduced };
};

export const todoCallsTo = (app: ReturnType<typeof createFakeApp>, method: string) =>
  app.calls.filter((call) => call.method === method);

export const todoRowOf = (id: number): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-id="${id}"]`);

  if (!found) throw new Error(`no row for #${id}`);

  return found;
};

export const assertKind = (button: HTMLElement, kind: "idle" | "blocked" | "done", drawing: "ring" | "dashed" | "check") => {
  const row = button.closest<HTMLElement>(".shelf-row") ?? button;
  const mark = within(row).getByRole("img", { name: { idle: "Idle", blocked: "Blocked", done: "Done" }[kind] });

  expect(within(row).getAllByRole("img")).toEqual([mark]);
  expect(mark.querySelectorAll("svg")).toHaveLength(1);
  expect(mark.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(mark.getAttribute("data-drawing")).toBe(drawing);
  expect(mark.textContent).toBe("");
};
