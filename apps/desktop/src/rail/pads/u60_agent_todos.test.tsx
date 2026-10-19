import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { SCOPE_ROW } from "../../testing/nodes";
import { showEverything, withScopeRow } from "../../testing/showEverything";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";
import { DrawerHost } from "../../drawer/DrawerHost";
import { Keys } from "../../keys/Keys";
import { Pads } from "../../pads/Pads";
import { ConnectedProjectContext, connectProject } from "../../state/connectedProject";
import { createFakeApp } from "../../testing/fakeApp";
import { agent, event, NOW } from "../../testing/nodes";
import { padHandlers, todoHandlers } from "../../testing/stores";
import type { PadStore, TodoStore } from "../../testing/stores";
import { Todos } from "../../todos/Todos";
import { todo } from "../../todos/testHarness";
import { Rail } from "../Rail";
import { rowOf } from "../railFixture";

afterEach(cleanup);

const by = (id: string): Actor => ({ kind: "agent", id, parent: null });

const padOf = (name: string, who: Actor): Pad => ({ incarnation: `fixture-${name}`, name, owner: who, text: "", updated_at: 0, revision: 1, home: null });

const mount = async (tree: RailNode[], todos: Todo[], pads: Pad[] = []) => {
  const padState: PadStore = { pads, history: [] };
  const store: TodoStore = { todos };
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => withScopeRow(tree);
  Object.assign(app.handlers, padHandlers(padState, (data) => app.emit(event(data))));
  Object.assign(app.handlers, todoHandlers(store, (data) => app.emit(event(data))));

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => NOW);
  await showEverything(connected);

  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Keys />
      <Rail />
      <Pads />
      <Todos />
      <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
    </ConnectedProjectContext.Provider>
  ));

  await connected.rail.settled();

  return { app, store, connected };
};

const TREE = [agent("a1", "working", "x", { name: "auth" }), agent("a2", "working", "x", { name: "docs", order: 1 })];

const control = (row: HTMLElement) => within(row).queryByRole("button", { name: /(pads|todos)$/ });

const shelf = () => within(screen.getByRole("region", { name: "Todos" }));

const opened = async () => {
  const button = await waitFor(() => control(rowOf("auth")) ?? Promise.reject(new Error("no control")));

  fireEvent.click(button);

  return button;
};

describe("u60 an Agent's Todos under it", () => {
  it("u60_the_control_counts_pads_and_open_todos_together", async () => {
    await mount(TREE, [todo(1, { creator: by("a1") }), todo(2, { creator: by("a1"), done: true })], [padOf("n", by("a1"))]);

    await waitFor(() => expect(control(rowOf("auth"))?.textContent?.trim()).toBe("2"));
    expect(control(rowOf("docs"))).toBeNull();
  });

  it("u60_expanded_the_pads_come_first_then_the_open_todos_in_id_order", async () => {
    await mount(
      TREE,
      [todo(5, { creator: by("a1") }), todo(3, { creator: by("a1"), blockers: [4], blocked: true }), todo(4, { creator: by("a1") })],
      [padOf("notes", by("a1"))],
    );
    await opened();

    const group = within(screen.getByRole("tree", { name: "Rail" })).getByRole("button", { name: "notes" }).closest<HTMLElement>("[data-pads]")!;

    expect([...group.querySelectorAll("[data-todo], .rail-pad")].map((row) => row.getAttribute("data-todo") ?? "pad")).toEqual(["pad", "3", "4", "5"]);
    expect(within(group).getByText(/Waits on/).closest("[data-todo-waits]")?.textContent).toContain("#4");
    expect(within(group).getByRole("button", { name: /#4 todo 4/ })).toBeTruthy();
  });

  it("u60_a_click_on_a_todo_opens_its_drawer_without_a_creator_line", async () => {
    const { connected } = await mount(TREE, [todo(1, { creator: by("a1") })]);

    await opened();
    fireEvent.click(within(screen.getByRole("tree", { name: "Rail" })).getByRole("button", { name: /#1 todo 1/ }));

    const drawer = await screen.findByLabelText("Drawer");

    await within(drawer).findByText("Blocker");
    expect(within(drawer).queryByText("Created by auth")).toBeNull();
    expect(connected.rail.selected()).toBeNull();
  });

  it("u60_the_drawer_omits_creator_for_the_user_and_an_agent_off_the_rail", async () => {
    await mount(TREE, [todo(1), todo(2, { creator: by("gone") })]);

    fireEvent.click(await screen.findByText("Unassigned"));
    fireEvent.click(await shelf().findByRole("button", { name: /#1 todo 1/ }));
    await within(await screen.findByLabelText("Drawer")).findByText("Blocker");
    expect(within(screen.getByLabelText("Drawer")).queryByText("Created by you")).toBeNull();

    fireEvent.click(shelf().getByRole("button", { name: /#2 todo 2/ }));
    await within(screen.getByLabelText("Drawer")).findByText("Blocker");
    expect(within(screen.getByLabelText("Drawer")).queryByText("Created by gone")).toBeNull();
  });

  it("u60_complete_works_on_a_todo_under_its_agent", async () => {
    const { app } = await mount(TREE, [todo(1, { creator: by("a1") })]);

    await opened();

    const row = within(screen.getByRole("tree", { name: "Rail" })).getByRole("button", { name: /#1 todo 1/ }).closest<HTMLElement>("[data-todo]")!;

    fireEvent.mouseEnter(row);
    fireEvent.click(within(row).getByRole("button", { name: "Complete" }));

    await waitFor(() => expect(app.calls.filter((call) => call.method === "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 1 } }]));
    await waitFor(() => expect(control(rowOf("auth"))).toBeNull());
  });

  it("u60_the_rail_and_the_shelf_share_one_todo_list_and_the_rows_leave_the_agents_alone", async () => {
    const { app } = await mount(TREE, [todo(1, { creator: by("a1") })]);

    await opened();

    expect(app.calls.filter((call) => call.method === "todo.list")).toHaveLength(1);
    expect([...document.querySelectorAll("[role=tree] :is([data-part=item], [data-part=branch-control])[data-id]")].map((row) => row.getAttribute("data-id"))).toEqual(["a1", "a2", SCOPE_ROW]);
  });
});
